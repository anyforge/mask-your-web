// lw.PPOCR.C OCR 引擎封装（Chrome 扩展版，去 eval）
// 依赖（由 manifest 按顺序注入 isolated world）：
//   - ocr-runtime.js：直接定义全局 LwPpocrModule（异步工厂函数）
//   - ocr-models.js：定义 window.__OCR_MODELS = { det/cls/rec/dict base64 }
// 暴露：window.LwOcr = { boot(), recognize(imageBitmap), shutdown, ready }
(() => {
  const WEB_ABI_VERSION = 1;
  let moduleInstance = null;
  let bootPromise = null;
  let maxLineCapacity = 0, maxTextCapacity = 0, lineSize = 0, resultSize = 0;
  const buffers = { source: 0, lines: 0, text: 0, result: 0 };
  let sourceCapacity = 0;

  function decodeBase64(value) {
    const raw = atob(value);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; ++i) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }
  function readU32(p) { return moduleInstance.HEAPU32[p >> 2] >>> 0; }
  function readF32(p) { return moduleInstance.HEAPF32[p >> 2]; }
  function readUtf8(p, len) { return new TextDecoder().decode(moduleInstance.HEAPU8.subarray(p, p + len)); }

  // 去 eval：LwPpocrModule 由 ocr-runtime.js 直接定义为全局，无需 eval 从字符串构造
  function makeFactory() { return LwPpocrModule; }

  function allocate(size, label) {
    const p = moduleInstance._lw_web_malloc(size);
    if (!p) throw new Error('无法分配 ' + label + '（' + size + ' 字节）');
    return p;
  }

  function shutdown() {
    if (!moduleInstance) return;
    for (const name of ['source', 'lines', 'text', 'result']) {
      if (buffers[name]) moduleInstance._lw_web_free(buffers[name]);
      buffers[name] = 0;
    }
    sourceCapacity = 0;
    maxLineCapacity = 0; maxTextCapacity = 0; lineSize = 0; resultSize = 0;
    try { moduleInstance._lw_web_shutdown(); } catch {}
    moduleInstance = null;
  }

  async function boot() {
    if (moduleInstance) return moduleInstance;
    if (bootPromise) return bootPromise;
    bootPromise = (async () => {
      if (typeof LwPpocrModule === 'undefined' || !window.__OCR_MODELS) throw new Error('OCR 引擎资源未加载');
      moduleInstance = await makeFactory()({});
      moduleInstance.FS.mkdir('/models');
      const files = [['det.lwm', 'det'], ['cls.lwm', 'cls'], ['rec.lwm', 'rec'], ['ppocr_keys.txt', 'dict']];
      for (const [name, key] of files) moduleInstance.FS.writeFile('/models/' + name, decodeBase64(window.__OCR_MODELS[key]));
      const status = moduleInstance._lw_web_init(1); // 启用 CLS 方向分类
      if (status !== 0) throw new Error('初始化失败：' + status);
      const infoSize = moduleInstance._lw_web_info_size();
      if (infoSize !== 20) throw new Error('不支持的 Web ABI 信息大小：' + infoSize);
      const infoPtr = allocate(infoSize, 'Web ABI 信息');
      try {
        const st = moduleInstance._lw_web_get_info(infoPtr);
        if (st !== 0) throw new Error('读取引擎容量失败：' + st);
        if (readU32(infoPtr) !== WEB_ABI_VERSION) throw new Error('不支持的 Web ABI：' + readU32(infoPtr));
        maxLineCapacity = readU32(infoPtr + 4);
        maxTextCapacity = readU32(infoPtr + 8);
        lineSize = readU32(infoPtr + 12);
        resultSize = readU32(infoPtr + 16);
        if (!maxLineCapacity || !maxTextCapacity || lineSize !== 60 || resultSize !== 16) throw new Error('引擎返回无效容量');
      } finally { moduleInstance._lw_web_free(infoPtr); }
      buffers.lines = allocate(maxLineCapacity * lineSize, '识别行缓冲区');
      buffers.text = allocate(maxTextCapacity, '文本缓冲区');
      buffers.result = allocate(resultSize, '结果缓冲区');
      return moduleInstance;
    })();
    return bootPromise;
  }

  function ensureSourceCapacity(required) {
    if (required <= sourceCapacity) return buffers.source;
    const p = allocate(required, '输入图像缓冲区');
    if (buffers.source) moduleInstance._lw_web_free(buffers.source);
    buffers.source = p;
    sourceCapacity = required;
    return p;
  }

  // 输入 ImageBitmap，返回 { width, height, lines:[{box:[8], text, detection, recognition}] }
  async function recognize(imageBitmap) {
    if (!moduleInstance) await boot();
    const w = imageBitmap.width, h = imageBitmap.height;
    const scale = Math.min(1, 1600 / Math.max(w, h));
    const ow = Math.max(1, Math.round(w * scale));
    const oh = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = ow; canvas.height = oh;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imageBitmap, 0, 0, ow, oh);
    const rgba = ctx.getImageData(0, 0, ow, oh).data;
    const bgr = new Uint8Array(ow * oh * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4) { bgr[j++] = rgba[i + 2]; bgr[j++] = rgba[i + 1]; bgr[j++] = rgba[i]; }
    const src = ensureSourceCapacity(bgr.length);
    moduleInstance.HEAPU8.set(bgr, src);
    const status = moduleInstance._lw_web_run(src, bgr.length, ow, oh, ow * 3, buffers.lines, maxLineCapacity, buffers.text, maxTextCapacity, buffers.result);
    if (status !== 0) throw new Error('推理失败：' + status);
    const lineCount = readU32(buffers.result);
    const lines = [];
    for (let i = 0; i < lineCount; i++) {
      const p = buffers.lines + i * lineSize;
      const box = [];
      for (let k = 0; k < 8; k++) box.push(readF32(p + k * 4));
      const offset = readU32(p + 52), length = readU32(p + 56);
      if (offset > maxTextCapacity || length > maxTextCapacity - offset) throw new Error('文本范围无效');
      lines.push({ box, text: readUtf8(buffers.text + offset, length), detection: readF32(p + 32), recognition: readF32(p + 36) });
    }
    return { width: ow, height: oh, lines };
  }

  window.LwOcr = {
    boot,
    recognize,
    shutdown,
    get ready() { return !!moduleInstance; },
  };
})();
