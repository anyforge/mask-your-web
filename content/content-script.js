// content-script.js — 轻量主逻辑（每个页面注入，检查配置后按需触发引擎注入）
(() => {
  'use strict';
  if (window.__maskContentLoaded) return;
  window.__maskContentLoaded = true;

  // ===== URL 匹配（与 Electron 版 main.js 一致）=====
  function stripWww(host) { return String(host).toLowerCase().replace(/^www\./, ''); }
  function normalizeCandidate(s) {
    s = String(s || '').trim();
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    try { return new URL(s); } catch { return null; }
  }
  function urlMatchesMask(url, urls) {
    if (!url || !urls || !urls.length) return false;
    let u;
    try { u = new URL(url); } catch { return false; }
    for (const cand of urls) {
      const cu = normalizeCandidate(cand);
      if (!cu) continue;
      if (stripWww(u.host) !== stripWww(cu.host)) continue;
      if (cu.port && u.port && cu.port !== u.port) continue;
      const cp = cu.pathname.replace(/\/+$/, '');
      const up = u.pathname;
      if (!cp || cp === '/') return true;
      if (up === cp || up.startsWith(cp + '/')) return true;
    }
    return false;
  }

  // ===== 图片 OCR 打码（复用 Electron renderer 逻辑）=====
  function getOcrRecognizers(rules) {
    const regexes = [], dict = [];
    for (const r of rules || []) {
      if (r.scope !== 'full') continue;
      for (const rec of r.recognizers || []) {
        if (rec.type === 'regex') regexes.push(rec.pattern);
        else if (rec.type === 'dict') dict.push(...(rec.items || []));
      }
    }
    return { regexes, dict };
  }
  function compileRegexes(regexes) {
    return (regexes || []).map(r => { try { return new RegExp(String(r)); } catch { return null; } }).filter(Boolean);
  }
  function buildDict(dict) {
    return new Set((dict || []).map(d => String(d).trim()).filter(Boolean));
  }
  function matchMaskRules(lines, ocrW, ocrH, imgW, imgH, regexList, dictSet) {
    const sx = imgW / ocrW, sy = imgH / ocrH;
    const boxes = [];
    for (const line of lines) {
      const text = line.text || '';
      if (!text) continue;
      let hit = regexList.some(re => re.test(text));
      if (!hit) { for (const w of dictSet) { if (text.includes(w)) { hit = true; break; } } }
      if (!hit) continue;
      const b = line.box;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let k = 0; k < 8; k += 2) { minX = Math.min(minX, b[k]); maxX = Math.max(maxX, b[k]); minY = Math.min(minY, b[k + 1]); maxY = Math.max(maxY, b[k + 1]); }
      boxes.push([minX * sx, minY * sy, Math.max(1, (maxX - minX) * sx), Math.max(1, (maxY - minY) * sy)]);
    }
    return boxes;
  }
  async function maskImageBuffer(buffer, boxes) {
    const bitmap = await createImageBitmap(new Blob([buffer]));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    for (const [x, y, w, h] of boxes) {
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold ' + Math.max(10, Math.min(22, h * 0.6)) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('***', x + w / 2, y + h / 2);
    }
    if (bitmap.close) bitmap.close();
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  async function fetchImage(src) {
    src = String(src || '');
    if (src.startsWith('data:')) {
      const b64 = src.match(/^data:[^;,]*;base64,([\s\S]*)$/);
      if (b64) {
        const bin = atob(b64[1]);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes.buffer;
      }
      const enc = src.match(/^data:[^,]*,(.*)$/);
      if (enc) return new TextEncoder().encode(decodeURIComponent(enc[1])).buffer;
      return null;
    }
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'fetch-image', src });
      if (!resp || !resp.ok) return null;
      return new Uint8Array(resp.buffer).buffer;
    } catch (e) { return null; }
  }

  let ocrBusy = false;
  async function runImageMask(rules, regexList, dictSet) {
    if (ocrBusy) return;
    const imgs = Array.from(document.querySelectorAll('img')).filter(img =>
      !img.dataset.maskChecked && img.naturalWidth >= 32 && img.naturalHeight >= 32 && (img.currentSrc || img.src)
    );
    if (!imgs.length) return;
    ocrBusy = true;
    try {
      await window.LwOcr.boot();
      for (const img of imgs) {
        img.dataset.maskChecked = '1';
        try {
          const buf = await fetchImage(img.currentSrc || img.src);
          if (!buf) continue;
          const bitmap = await createImageBitmap(new Blob([buf]));
          const r = await window.LwOcr.recognize(bitmap);
          const boxes = matchMaskRules(r.lines, r.width, r.height, bitmap.width, bitmap.height, regexList, dictSet);
          if (boxes.length) img.src = await maskImageBuffer(buf, boxes);
          if (bitmap.close) bitmap.close();
        } catch (e) { /* 单张失败跳过 */ }
      }
    } catch (e) { /* OCR 引擎失败 */ }
    finally { ocrBusy = false; }
  }

  // ===== Canvas 表格脱敏（截图 → OCR → 覆盖层打码；无列语义，只用 full 规则）=====
  let canvasBusy = false;
  let canvasMasks = [];
  let canvasRescanTimer = null;

  function canvasClamp(v, def, min, max) {
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return def;
    return Math.max(min, Math.min(max, n));
  }

  function ensureCanvasOverlay(canvas) {
    let entry = canvasMasks.find(e => e.canvas === canvas);
    if (entry) return entry;
    const parent = canvas.parentElement;
    if (!parent) return null;
    try {
      const cs = getComputedStyle(parent);
      if (cs.position === 'static') parent.style.position = 'relative';
    } catch (e) {}
    const overlay = document.createElement('div');
    overlay.className = 'tm-canvas-mask';
    overlay.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;overflow:hidden;z-index:2147483647;';
    parent.appendChild(overlay);
    entry = { canvas, parent, overlay };
    canvasMasks.push(entry);
    return entry;
  }

  function drawCanvasOverlay(canvas, boxes, bitmapW, bitmapH) {
    const entry = ensureCanvasOverlay(canvas);
    if (!entry) return;
    const rect = canvas.getBoundingClientRect();
    const parentRect = entry.parent.getBoundingClientRect();
    const sx = bitmapW ? rect.width / bitmapW : 1;
    const sy = bitmapH ? rect.height / bitmapH : 1;
    entry.overlay.style.left = (rect.left - parentRect.left) + 'px';
    entry.overlay.style.top = (rect.top - parentRect.top) + 'px';
    entry.overlay.style.width = rect.width + 'px';
    entry.overlay.style.height = rect.height + 'px';
    entry.overlay.innerHTML = '';
    for (const [x, y, w, h] of boxes) {
      const bw = Math.max(1, w * sx), bh = Math.max(1, h * sy);
      const block = document.createElement('div');
      block.style.cssText = 'position:absolute;background:#1f2937;';
      block.style.left = (x * sx) + 'px';
      block.style.top = (y * sy) + 'px';
      block.style.width = bw + 'px';
      block.style.height = bh + 'px';
      const star = document.createElement('div');
      star.textContent = '***';
      star.style.cssText = 'position:absolute;left:0;top:50%;transform:translateY(-50%);width:100%;text-align:center;color:#fff;font-size:' + Math.max(9, Math.min(14, bh * 0.5)) + 'px;line-height:1;';
      block.appendChild(star);
      entry.overlay.appendChild(block);
    }
  }

  function clearCanvasOverlay(canvas) {
    const idx = canvasMasks.findIndex(e => e.canvas === canvas);
    if (idx < 0) return;
    try { canvasMasks[idx].overlay.remove(); } catch (e) {}
    canvasMasks.splice(idx, 1);
  }

  async function maskCanvas(canvas, regexList, dictSet) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(canvas);
    } catch (e) { return; } // tainted / 不可读
    try {
      const r = await window.LwOcr.recognize(bitmap);
      const boxes = matchMaskRules(r.lines, r.width, r.height, bitmap.width, bitmap.height, regexList, dictSet);
      if (boxes.length) drawCanvasOverlay(canvas, boxes, bitmap.width, bitmap.height);
      else clearCanvasOverlay(canvas);
    } catch (e) { /* OCR 失败 */ }
    finally { if (bitmap.close) bitmap.close(); }
  }

  async function runCanvasMask(regexList, dictSet, minW, minH) {
    if (canvasBusy) return;
    const canvases = Array.from(document.querySelectorAll('canvas')).filter(c => {
      const r = c.getBoundingClientRect();
      return r.width >= minW && r.height >= minH;
    });
    for (const e of canvasMasks.slice()) {
      if (!e.canvas.isConnected) clearCanvasOverlay(e.canvas);
    }
    if (!canvases.length) return;
    canvasBusy = true;
    try {
      await window.LwOcr.boot();
      for (const c of canvases) {
        try { await maskCanvas(c, regexList, dictSet); } catch (e) {}
      }
    } catch (e) {}
    finally { canvasBusy = false; }
  }

  // ===== 主流程 =====
  (async () => {
    let config;
    try {
      const { maskConfig } = await chrome.storage.sync.get('maskConfig');
      config = maskConfig || { enabled: false, urls: [], rules: [] };
    } catch (e) { config = { enabled: false, urls: [], rules: [] }; }

    if (!config.enabled || !config.urls || !config.urls.length) return;
    if (!urlMatchesMask(location.href, config.urls)) return;

    // 命中 → 请求 background 注入引擎（ocrEnabled=false 时不注入 OCR 模型）
    const wantOcr = config.ocrEnabled !== false || config.canvasEnabled === true;
    let resp;
    try { resp = await chrome.runtime.sendMessage({ type: 'mask-init', ocr: wantOcr }); } catch (e) { resp = null; }
    if (!resp || !resp.ok) return;

    // 文本脱敏
    if (window.__textMask && config.rules && config.rules.length) {
      try { window.__textMask.init({ rules: config.rules }); } catch (e) {}
    }

    // 图片 OCR 脱敏（受 ocrEnabled 开关控制；首次 + 轮询懒加载图）
    if (wantOcr) {
      const ocr = getOcrRecognizers(config.rules);
      if (ocr.regexes.length || ocr.dict.length) {
        const regexList = compileRegexes(ocr.regexes);
        const dictSet = buildDict(ocr.dict);
        await runImageMask(config.rules, regexList, dictSet);
        setInterval(() => runImageMask(config.rules, regexList, dictSet), 2000);
      }
    }

    // Canvas 表格脱敏（受 canvasEnabled 开关控制；需要 OCR）
    if (config.canvasEnabled === true && wantOcr) {
      const cRec = getOcrRecognizers(config.rules);
      if (cRec.regexes.length || cRec.dict.length) {
        const cRegexList = compileRegexes(cRec.regexes);
        const cDictSet = buildDict(cRec.dict);
        const minW = canvasClamp(config.canvasMinWidth, 200, 50, 4000);
        const minH = canvasClamp(config.canvasMinHeight, 200, 50, 4000);
        const run = () => runCanvasMask(cRegexList, cDictSet, minW, minH);
        await run();
        setInterval(run, 2000);
        const schedule = () => {
          clearTimeout(canvasRescanTimer);
          canvasRescanTimer = setTimeout(run, 500);
        };
        window.addEventListener('wheel', schedule, { capture: true, passive: true });
        window.addEventListener('scroll', schedule, { capture: true, passive: true });
        window.addEventListener('mouseup', schedule, { capture: true, passive: true });
      }
    }
  })();
})();
