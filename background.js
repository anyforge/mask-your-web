// background.js — service worker
// 职责：
//   1) mask-init：按需向命中页面注入 OCR 引擎 + 文本引擎（isolated world）
//   2) fetch-image：跨域下载图片数据（<all_urls> 权限绕过 CORS）

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'mask-init') {
    const tabId = sender.tab && sender.tab.id;
    if (tabId == null) { sendResponse({ ok: false, error: 'no tab' }); return true; }
    const files = [];
    if (msg.ocr !== false) {
      files.push('content/ocr-runtime.js', 'content/ocr-models.js', 'content/ocr-engine.js');
    }
    files.push('content/text-mask-engine.js');
    chrome.scripting.executeScript({
      target: { tabId },
      files,
    }).then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true; // 异步 sendResponse
  }

  if (msg.type === 'fetch-image') {
    fetch(msg.src)
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      })
      .then(buf => sendResponse({ ok: true, buffer: Array.from(new Uint8Array(buf)) }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  return false;
});
