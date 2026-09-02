// text-mask-engine.js — 文本脱敏引擎（注入到网页，自包含）
// 职责：DOM 文本节点扫描 + 表格列名/列值识别 + iframe 递归 + 视觉遮罩（hover 显原文）
// 与宿主（main.js）完全解耦：只通过 window.__textMask.init(config) 接收配置，不依赖任何外部代码。
(function () {
  'use strict';
  if (window.__textMaskInstalled) return; // 幂等，避免重复注入
  window.__textMaskInstalled = true;

  // ===== 注入遮罩样式（随引擎一起进网页；WebContentsView 是独立渲染上下文，app 的 style.css 管不到这里）=====
  function injectStyle() {
    try {
      if (document.getElementById('__tm-mask-style')) return;
      const style = document.createElement('style');
      style.id = '__tm-mask-style';
      style.textContent = '.tm-mask{color:transparent!important;background:#d0d3d8!important;border-radius:3px;user-select:none;transition:color .15s ease,background .15s ease}.tm-mask:hover{color:inherit!important;background:transparent!important;user-select:text}.tm-range-mask{position:absolute;background:#d0d3d8;border-radius:3px;z-index:2147483647}.tm-range-mask:hover{opacity:0}';
      (document.head || document.documentElement).appendChild(style);
    } catch (e) {}
  }
  injectStyle();

  // ===== 状态 =====
  let fullRules = [];          // scope=full 的规则（编译后的 recognizers）
  let columnNameRules = [];    // scope=column-name 的规则
  let columnValueRules = [];   // scope=column-value 的规则
  let observer = null;
  let scanTimer = null;
  let overlays = [];       // 当前所有 Range 覆盖层元素
  let scrollTimer = null;  // 滚动/重排重扫防抖
  let scrollWatching = false;

  // ===== 规则编译 =====
  // recognizer: { type:'regex', pattern } 或 { type:'dict', items:[...] }
  // 每个识别规则可配：keepFirst（保留前 N，默认 1）、keepLast（保留后 N，默认 1）
  function clampInt(v, def, min, max) {
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return def;
    return Math.max(min, Math.min(max, n));
  }
  function compileRecognizer(rec) {
    if (!rec) return null;
    const keepFirst = clampInt(rec.keepFirst, 1, 0, 50);
    const keepLast = clampInt(rec.keepLast, 1, 0, 50);
    if (rec.type === 'regex') {
      const pattern = String(rec.pattern || '').trim();
      if (!pattern) return null;
      try {
        const re = new RegExp(pattern, 'g');
        return { type: 'regex', re, keepFirst, keepLast };
      } catch (e) { return null; } // 非法正则静默丢弃
    }
    if (rec.type === 'dict') {
      const items = (Array.isArray(rec.items) ? rec.items : []).map(String).map(s => s.trim()).filter(Boolean);
      if (!items.length) return null;
      return { type: 'dict', items, keepFirst, keepLast };
    }
    return null;
  }
  function compileRule(rule) {
    if (!rule) return null;
    const recognizers = (Array.isArray(rule.recognizers) ? rule.recognizers : []).map(compileRecognizer).filter(Boolean);
    if (!recognizers.length) return null;
    return { scope: rule.scope, recognizers };
  }
  function loadRules(rules) {
    fullRules = []; columnNameRules = []; columnValueRules = [];
    for (const rule of (Array.isArray(rules) ? rules : [])) {
      const c = compileRule(rule);
      if (!c) continue;
      if (c.scope === 'column-name') columnNameRules.push(c.recognizers);
      else if (c.scope === 'column-value') columnValueRules.push(c.recognizers);
      else fullRules.push(c.recognizers); // full 及未知作用域都按全文处理
    }
  }

  // ===== 匹配：正则优先，词典兜底（词典跳过正则已命中的范围） =====
  function matchText(text, recognizerGroups) {
    if (!text) return [];
    const hits = [];
    for (const recs of recognizerGroups) {
      for (const rec of recs) {
        if (rec.type === 'regex') {
          rec.re.lastIndex = 0;
          let m;
          while ((m = rec.re.exec(text)) !== null) {
            if (m[0].length === 0) { rec.re.lastIndex++; continue; }
            hits.push({ start: m.index, end: m.index + m[0].length, keepFirst: rec.keepFirst, keepLast: rec.keepLast });
          }
        } else if (rec.type === 'dict') {
          for (const item of rec.items) {
            let idx = 0;
            while ((idx = text.indexOf(item, idx)) !== -1) {
              const end = idx + item.length;
              if (!covered(hits, idx, end)) hits.push({ start: idx, end, keepFirst: rec.keepFirst, keepLast: rec.keepLast });
              idx = end;
            }
          }
        }
      }
    }
    return mergeHits(hits);
  }
  function covered(hits, s, e) {
    return hits.some(h => h.start <= s && h.end >= e);
  }
  function mergeHits(hits) {
    if (!hits.length) return [];
    hits.sort((a, b) => a.start - b.start);
    const out = [];
    let cur = hits[0];
    for (let i = 1; i < hits.length; i++) {
      const h = hits[i];
      if (h.start <= cur.end) {
        if (h.end > cur.end) cur.end = h.end;
        // 重叠合并时保守：保留更小的前后保留数（遮得更多）
        cur.keepFirst = Math.min(cur.keepFirst, h.keepFirst);
        cur.keepLast = Math.min(cur.keepLast, h.keepLast);
      } else { out.push(cur); cur = h; }
    }
    out.push(cur);
    return out;
  }

  // ===== 遮罩：Range 覆盖层精确遮中间（前 N 后 N 可见），hover 显原文 =====
  // 关键：不拆节点、不 replaceChild —— 用 Range 测量命中子串位置，盖 position:fixed 浮动遮罩。
  // 既保留局部遮罩（前 N 后 N），又不破坏 React/umi 管理的 DOM 结构（覆盖层是 body 的独立子元素）。
  function clearOverlays() {
    for (const el of overlays) { try { el.remove(); } catch (e) {} }
    overlays = [];
  }
  function addOverlay(parent, left, top, width, height) {
    try {
      const div = parent.ownerDocument.createElement('div');
      div.className = 'tm-range-mask';
      div.style.left = left + 'px';
      div.style.top = top + 'px';
      div.style.width = width + 'px';
      div.style.height = height + 'px';
      parent.appendChild(div);
      overlays.push(div);
    } catch (e) {}
  }
  function maskTextNode(node, hits) {
    const parent = node.parentElement;
    if (!parent) return;
    const doc = node.ownerDocument;
    // 覆盖层作为父元素的子元素，absolute 相对父元素（父元素转 relative），随父元素一起滚，不漂移
    try {
      const cs = doc.defaultView.getComputedStyle(parent);
      if (cs.position === 'static') parent.style.position = 'relative';
    } catch (e) {}
    const parentRect = parent.getBoundingClientRect();
    for (const h of hits) {
      const hitLen = h.end - h.start;
      const keepF = Math.min(Math.max(0, h.keepFirst | 0), hitLen);
      const keepL = Math.min(Math.max(0, h.keepLast | 0), hitLen - keepF);
      const subStart = h.start + keepF;
      const subEnd = h.end - keepL;
      if (subEnd <= subStart) continue; // 前后保留覆盖全部 → 相当于不遮罩
      try {
        const range = doc.createRange();
        range.setStart(node, subStart);
        range.setEnd(node, subEnd);
        const rects = range.getClientRects();
        for (let i = 0; i < rects.length; i++) {
          const r = rects[i];
          if (r.width < 1 || r.height < 1) continue;
          addOverlay(parent, r.left - parentRect.left, r.top - parentRect.top, r.width, r.height);
        }
      } catch (e) {}
    }
  }

  function maskNodeByRules(node, recognizerGroups) {
    const hits = matchText(node.textContent, recognizerGroups);
    if (hits.length) maskTextNode(node, hits);
  }

  // ===== 全文文本扫描 =====
  function collectTextNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (p.closest('script,style,noscript,textarea,input,select,option')) return NodeFilter.FILTER_REJECT;
        if (p.closest('.tm-mask')) return NodeFilter.FILTER_REJECT; // 已打码跳过（幂等）
        if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  }
  function scanText(root) {
    if (!fullRules.length) return;
    const nodes = collectTextNodes(root);
    for (const node of nodes) maskNodeByRules(node, fullRules);
  }

  // ===== 表格扫描（列名 > 列值） =====
  function maskCellAll(cell) {
    // 整列打码：直接给单元格加 .tm-mask（不拆节点）
    if (!cell.closest('.tm-mask')) cell.classList.add('tm-mask');
  }
  function maskCellByRules(cell, recognizerGroups) {
    const nodes = collectTextNodes(cell);
    for (const node of nodes) maskNodeByRules(node, recognizerGroups);
  }

  // 处理一组「表头 + 数据行」：返回已整列打码的列 index 集合
  function processGrid(headers, rows, cellsOfRow) {
    const maskedCols = new Set();
    // 1) column-name 规则：表头命中 → 整列打码
    if (columnNameRules.length) {
      headers.forEach((h, colIdx) => {
        if (maskedCols.has(colIdx)) return;
        if (matchText(h.textContent || '', columnNameRules).length) {
          maskedCols.add(colIdx);
          rows.forEach(row => {
            const cells = cellsOfRow(row);
            const cell = cells[colIdx];
            if (cell) maskCellAll(cell);
          });
        }
      });
    }
    // 2) column-value 规则：列值命中（排除表头 + 已整列打码的列）
    if (columnValueRules.length) {
      rows.forEach(row => {
        const cells = cellsOfRow(row);
        cells.forEach((cell, colIdx) => {
          if (maskedCols.has(colIdx)) return;
          maskCellByRules(cell, columnValueRules);
        });
      });
    }
    return maskedCols;
  }

  function scanHtmlTable(table) {
    try {
      const thead = table.querySelector('thead');
      const headerRow = thead ? thead.querySelector('tr') : table.querySelector('tr');
      if (!headerRow) return;
      const headers = Array.from(headerRow.querySelectorAll('th, td'));
      if (!headers.length) return;
      const tbody = table.querySelector('tbody');
      const rows = tbody
        ? Array.from(tbody.querySelectorAll('tr'))
        : Array.from(table.querySelectorAll('tr')).slice(1);
      if (!rows.length) return;
      processGrid(headers, rows, (row) => Array.from(row.querySelectorAll('td')));
    } catch (e) {}
  }

  function scanRoleTable(container) {
    try {
      const rows = Array.from(container.querySelectorAll('[role="row"]'));
      if (rows.length < 2) return;
      const headerRow = rows[0];
      const headers = Array.from(headerRow.querySelectorAll('[role="columnheader"], [role="rowheader"]'));
      if (!headers.length) return;
      const dataRows = rows.slice(1);
      processGrid(headers, dataRows, (row) => Array.from(row.querySelectorAll('[role="cell"], [role="gridcell"]')));
    } catch (e) {}
  }

  function scanTables(root) {
    if (!columnNameRules.length && !columnValueRules.length) return;
    (root || document).querySelectorAll('table').forEach(scanHtmlTable);
    (root || document).querySelectorAll('[role="table"], [role="grid"]').forEach(scanRoleTable);
  }

  // ===== iframe 递归（同源；跨域拿不到 contentDocument，跳过） =====
  function scanIframes() {
    try {
      const frames = document.querySelectorAll('iframe');
      frames.forEach(f => {
        try {
          const doc = f.contentDocument;
          if (!doc || !doc.body) return; // 跨域 → contentDocument 为 null
          scanTables(doc);
          scanText(doc.body);
          scanIframesIn(doc); // 嵌套 iframe 递归
        } catch (e) { /* 跨域或异常，跳过 */ }
      });
    } catch (e) {}
  }
  function scanIframesIn(doc) {
    try {
      doc.querySelectorAll('iframe').forEach(f => {
        try {
          const d = f.contentDocument;
          if (!d || !d.body) return;
          scanTables(d);
          scanText(d.body);
          scanIframesIn(d);
        } catch (e) {}
      });
    } catch (e) {}
  }

  // ===== 全量扫描：列名 → 列值 → 全文 =====
  function scanAll() {
    try {
      clearOverlays();         // 重建前清除旧覆盖层（Range 覆盖层每次重算位置）
      scanTables(document);   // 第一、二遍：column-name（整列）→ column-value（列值）
      scanIframes();          // iframe 递归（同样三遍）
      scanText(document.body); // 第三遍：full（全文）
    } catch (e) {}
  }

  // 滚动/缩放时覆盖层（position:fixed 视口坐标）会与文本错位，防抖重扫
  function scheduleRescan() {
    if (scrollTimer) return;
    scrollTimer = setTimeout(() => { scrollTimer = null; scanAll(); }, 150);
  }
  function startScrollWatcher() {
    if (scrollWatching) return;
    scrollWatching = true;
    // 覆盖层 append 到父元素后随父元素滚动，无需 scroll 重扫；仅 resize（布局变化）需重扫
    window.addEventListener('resize', scheduleRescan, { passive: true });
  }

  // ===== MutationObserver：动态内容增量（防抖 + 幂等） =====
  function startObserver() {
    if (observer) return;
    try {
      observer = new MutationObserver(() => {
        if (scanTimer) return;
        scanTimer = setTimeout(() => {
          scanTimer = null;
          scanAll();
        }, 200);
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    } catch (e) {}
  }

  // ===== 对外接口 =====
  window.__textMask = {
    init(config) {
      try {
        loadRules((config && config.rules) || []);
        scanAll();
        startObserver();
        startScrollWatcher();
      } catch (e) {}
    },
    rescan() { scanAll(); },
    dispose() {
      try {
        if (observer) { observer.disconnect(); observer = null; }
        if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
        if (scrollTimer) { clearTimeout(scrollTimer); scrollTimer = null; }
        clearOverlays();
      } catch (e) {}
    },
  };
})();
