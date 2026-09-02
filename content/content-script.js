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
    const wantOcr = config.ocrEnabled !== false;
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
  })();
})();
