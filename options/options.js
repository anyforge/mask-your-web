// options.js — 配置页（macOS 风格 + 中英双语 + JSON 双向同步；存储 chrome.storage.sync）
// $ 修复：getElementById 不接受 # 前缀，统一剥掉（这是「新建脱敏规则没反应」的根因）
const $ = (sel) => document.getElementById(String(sel).replace(/^#/, ''));
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function isValidRegex(pattern) {
  if (!pattern) return true;
  try { new RegExp(pattern); return true; } catch { return false; }
}

// 编辑草稿：[{ name, scope, recognizers:[{type, value, keepFirst, keepLast}] }]
let maskRulesDraft = [];

// ── 规则：storage 格式 ⇄ 草稿 ──
function rulesToDraft(rules) {
  return (Array.isArray(rules) ? rules : []).map(r => ({
    name: String(r.name || '').trim(),
    scope: ['full', 'column-name', 'column-value'].includes(r.scope) ? r.scope : 'full',
    recognizers: (Array.isArray(r.recognizers) ? r.recognizers : []).map(rec => {
      const type = (rec && rec.type === 'dict') ? 'dict' : 'regex';
      const value = type === 'dict'
        ? (Array.isArray(rec.items) ? rec.items.map(s => String(s)).join('\n') : String(rec.items || ''))
        : String(rec.pattern || '');
      return {
        type,
        value,
        keepFirst: (rec && rec.keepFirst != null) ? rec.keepFirst : 1,
        keepLast: (rec && rec.keepLast != null) ? rec.keepLast : 1,
      };
    }),
  }));
}

function normKeep(v) {
  const s = String(v ?? '').trim();
  if (s === '') return 1;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? 1 : Math.max(0, Math.min(50, n));
}

// 草稿 → storage 规则（过滤空 recognizer / 空规则；用于「保存」）
function collectMaskRules() {
  const rules = [];
  for (const rule of maskRulesDraft) {
    const recognizers = [];
    for (const rec of rule.recognizers) {
      const val = String(rec.value || '').trim();
      if (!val) continue;
      const extras = { keepFirst: normKeep(rec.keepFirst), keepLast: normKeep(rec.keepLast) };
      if (rec.type === 'regex') recognizers.push({ type: 'regex', pattern: val, ...extras });
      else {
        const items = val.split('\n').map((s) => s.trim()).filter(Boolean);
        if (items.length) recognizers.push({ type: 'dict', items, ...extras });
      }
    }
    if (recognizers.length) rules.push({ name: String(rule.name || '').trim() || t('opts.unnamed'), scope: rule.scope || 'full', recognizers });
  }
  return rules;
}

// 草稿 → storage 规则（忠实不过滤；用于「JSON 展示」，让 JSON 与界面完全一致）
function draftToRulesRaw() {
  return maskRulesDraft.map(rule => ({
    name: String(rule.name || '').trim(),
    scope: rule.scope || 'full',
    recognizers: rule.recognizers.map(rec => {
      const keep = { keepFirst: normKeep(rec.keepFirst), keepLast: normKeep(rec.keepLast) };
      if (rec.type === 'dict') {
        const items = String(rec.value || '').split('\n').map(s => s.trim()).filter(Boolean);
        return { type: 'dict', items, ...keep };
      }
      return { type: 'regex', pattern: String(rec.value || ''), ...keep };
    }),
  }));
}

// 当前表单 → 完整配置对象（= storage maskConfig 格式）
function serializeConfig() {
  return {
    enabled: $('#mask-enabled').checked,
    ocrEnabled: $('#mask-ocr').checked,
    urls: $('#mask-urls').value.split('\n').map((s) => s.trim()).filter(Boolean),
    rules: draftToRulesRaw(),
  };
}

// ── 渲染 ──
function renderMaskRules() {
  const list = $('#mask-rules-list');
  if (!list) return;
  if (!maskRulesDraft.length) {
    list.innerHTML = '<div class="desc" style="padding:8px 0">' + t('opts.empty') + '</div>';
    return;
  }
  list.innerHTML = maskRulesDraft.map((rule, ri) => `
    <div class="mask-rule-card" data-ri="${ri}">
      <div class="mask-rule-head">
        <input class="mask-rule-name" placeholder="${t('opts.ruleName')}" value="${esc(rule.name)}" data-field="name" spellcheck="false">
        <select class="mask-rule-scope" data-field="scope">
          <option value="full" ${rule.scope === 'full' ? 'selected' : ''}>${t('opts.scopeFull')}</option>
          <option value="column-name" ${rule.scope === 'column-name' ? 'selected' : ''}>${t('opts.scopeColName')}</option>
          <option value="column-value" ${rule.scope === 'column-value' ? 'selected' : ''}>${t('opts.scopeColValue')}</option>
        </select>
        <button class="mask-rule-del" title="${t('opts.delRule')}" data-action="del-rule">🗑</button>
      </div>
      <div class="mask-rec-list">
        ${rule.recognizers.map((rec, ci) => `
          <div class="mask-rec" data-ci="${ci}">
            <select class="mask-rec-type" data-field="rec-type">
              <option value="regex" ${rec.type === 'regex' ? 'selected' : ''}>${t('opts.typeRegex')}</option>
              <option value="dict" ${rec.type === 'dict' ? 'selected' : ''}>${t('opts.typeDict')}</option>
            </select>
            ${rec.type === 'dict'
              ? `<textarea class="mask-rec-value mask-rec-dict" rows="2" placeholder="${t('opts.dictPh')}" data-field="rec-value" spellcheck="false">${esc(rec.value || '')}</textarea>`
              : `<input class="mask-rec-value${isValidRegex(rec.value || '') ? '' : ' invalid'}" placeholder="${t('opts.regexPh')}" value="${esc(rec.value || '')}" data-field="rec-value" spellcheck="false">`}
            <span class="mask-rec-keep" title="${t('opts.keepHint')}">
              ${t('opts.keepFirst')}<input type="number" min="0" max="50" class="mask-rec-keepfirst" value="${rec.keepFirst ?? 1}" data-field="rec-keepfirst">${t('opts.keepLast')}<input type="number" min="0" max="50" class="mask-rec-keeplast" value="${rec.keepLast ?? 1}" data-field="rec-keeplast">
            </span>
            <button class="mask-rec-del" title="${t('opts.delRec')}" data-action="del-rec">×</button>
          </div>
        `).join('')}
      </div>
      <button class="mask-rec-add" data-action="add-rec">${t('opts.newRec')}</button>
    </div>
  `).join('');
}

function bindMaskRulesEvents() {
  const list = $('#mask-rules-list');
  if (!list) return;
  list.onclick = (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const card = btn.closest('.mask-rule-card');
    const ri = parseInt(card.dataset.ri, 10);
    const action = btn.dataset.action;
    if (action === 'del-rule') { maskRulesDraft.splice(ri, 1); renderMaskRules(); bindMaskRulesEvents(); scheduleRenderJson(); }
    else if (action === 'add-rec') { maskRulesDraft[ri].recognizers.push({ type: 'regex', value: '', keepFirst: 1, keepLast: 1 }); renderMaskRules(); bindMaskRulesEvents(); scheduleRenderJson(); }
    else if (action === 'del-rec') {
      const ci = parseInt(btn.closest('.mask-rec').dataset.ci, 10);
      maskRulesDraft[ri].recognizers.splice(ci, 1);
      renderMaskRules(); bindMaskRulesEvents(); scheduleRenderJson();
    }
  };
  list.oninput = (e) => {
    const field = e.target.dataset.field;
    if (!field) return;
    const card = e.target.closest('.mask-rule-card');
    const ri = parseInt(card.dataset.ri, 10);
    const rule = maskRulesDraft[ri];
    if (!rule) return;
    if (field === 'name') { rule.name = e.target.value; scheduleRenderJson(); return; }
    if (field === 'scope') { rule.scope = e.target.value; scheduleRenderJson(); return; }
    const recEl = e.target.closest('.mask-rec');
    if (recEl) {
      const ci = parseInt(recEl.dataset.ci, 10);
      const rec = rule.recognizers[ci];
      if (!rec) return;
      if (field === 'rec-type') { rec.type = e.target.value; renderMaskRules(); bindMaskRulesEvents(); scheduleRenderJson(); }
      else if (field === 'rec-value') {
        rec.value = e.target.value;
        if (rec.type === 'regex') e.target.classList.toggle('invalid', !isValidRegex(e.target.value));
        scheduleRenderJson();
      }
      else if (field === 'rec-keepfirst') { rec.keepFirst = e.target.value; scheduleRenderJson(); }
      else if (field === 'rec-keeplast') { rec.keepLast = e.target.value; scheduleRenderJson(); }
    }
  };
}

// ── JSON 视图 ──
function renderJson() {
  const el = $('#mask-json');
  if (el) el.value = JSON.stringify(serializeConfig(), null, 2);
}

let jsonRenderTimer = null;
function scheduleRenderJson() {
  clearTimeout(jsonRenderTimer);
  jsonRenderTimer = setTimeout(renderJson, 150);
}

function setJsonStatus(type, msg) {
  const el = $('#mask-json-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'json-status' + (type ? ' ' + type : '');
}

// JSON 文本 → 表单（silent: 自动应用，不重排 JSON 文本、不弹提示）
function applyJsonFromText(silent) {
  const text = $('#mask-json').value.trim();
  if (!text) { setJsonStatus('', ''); return; }
  let cfg;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('root must be an object');
    cfg = {
      enabled: !!parsed.enabled,
      ocrEnabled: parsed.ocrEnabled !== false,
      urls: Array.isArray(parsed.urls) ? parsed.urls.map(s => String(s).trim()).filter(Boolean) : [],
      rules: rulesToDraft(Array.isArray(parsed.rules) ? parsed.rules : []),
    };
  } catch (e) {
    setJsonStatus('err', t('opts.jsonError') + ': ' + e.message);
    return;
  }
  $('#mask-enabled').checked = cfg.enabled;
  $('#mask-ocr').checked = cfg.ocrEnabled;
  $('#mask-urls').value = cfg.urls.join('\n');
  maskRulesDraft = cfg.rules;
  renderMaskRules();
  bindMaskRulesEvents();
  if (silent) {
    setJsonStatus('', '');
  } else {
    renderJson();
    setJsonStatus('ok', t('opts.jsonApplied'));
    setTimeout(() => setJsonStatus('', ''), 1500);
  }
}

let jsonApplyTimer = null;
function scheduleJsonApply() {
  clearTimeout(jsonApplyTimer);
  jsonApplyTimer = setTimeout(() => applyJsonFromText(true), 600);
}

async function init() {
  await loadLang();
  applyI18n();
  // 语言切换：切换后重渲染规则卡片（卡片内 scope/type/placeholder 文案依赖 LANG）
  document.querySelectorAll('[data-lang-toggle]').forEach(el => {
    el.onclick = async () => {
      await setLang(el.dataset.langToggle);
      renderMaskRules();
      bindMaskRulesEvents();
      renderJson();
    };
  });

  let cfg;
  try {
    const { maskConfig } = await chrome.storage.sync.get('maskConfig');
    cfg = maskConfig || { enabled: false, urls: [], rules: [] };
  } catch (e) { cfg = { enabled: false, urls: [], rules: [] }; }

  $('#mask-enabled').checked = !!cfg.enabled;
  $('#mask-ocr').checked = cfg.ocrEnabled !== false;
  $('#mask-urls').value = (cfg.urls || []).join('\n');
  maskRulesDraft = rulesToDraft(cfg.rules || []);
  renderMaskRules();
  bindMaskRulesEvents();
  renderJson();

  // 表单变化 → JSON 自动刷新
  $('#mask-enabled').onchange = scheduleRenderJson;
  $('#mask-ocr').onchange = scheduleRenderJson;
  $('#mask-urls').oninput = scheduleRenderJson;

  // JSON 编辑 → 表单自动应用（防抖）
  $('#mask-json').oninput = () => { setJsonStatus('', ''); scheduleJsonApply(); };
  $('#mask-json-apply').onclick = () => applyJsonFromText(false);
  $('#mask-json-copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText($('#mask-json').value);
      setJsonStatus('ok', t('opts.jsonCopied'));
      setTimeout(() => setJsonStatus('', ''), 1500);
    } catch (e) { setJsonStatus('err', e.message); }
  };
  $('#mask-json-import').onclick = () => $('#mask-json-file').click();
  $('#mask-json-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      $('#mask-json').value = text;
      applyJsonFromText(false);
    } catch (err) { setJsonStatus('err', err.message); }
    e.target.value = '';
  };

  $('#mask-rule-add').onclick = () => {
    maskRulesDraft.push({ name: '', scope: 'full', recognizers: [{ type: 'regex', value: '', keepFirst: 1, keepLast: 1 }] });
    renderMaskRules();
    bindMaskRulesEvents();
    scheduleRenderJson();
  };

  $('#mask-save').onclick = async () => {
    const next = {
      enabled: $('#mask-enabled').checked,
      ocrEnabled: $('#mask-ocr').checked,
      urls: $('#mask-urls').value.split('\n').map((s) => s.trim()).filter(Boolean),
      rules: collectMaskRules(),
    };
    await chrome.storage.sync.set({ maskConfig: next });
    renderJson();
    const st = $('#mask-status');
    st.textContent = t('opts.saved');
    setTimeout(() => { st.textContent = ''; }, 2000);
  };
}

init();
