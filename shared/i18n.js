// shared/i18n.js — 中英双语字典 + 语言切换（popup / options 共用）
const I18N = {
  zh: {
    'brand': 'MaskYourWeb',
    // popup
    'popup.loading': '读取当前网页…',
    'popup.apply': '应用于当前网页',
    'popup.settings': '配置',
    'popup.applied': '已应用',
    'popup.notApplied': '未应用',
    'popup.unknown': '（无法识别当前网页）',
    // options
    'opts.title': '网页脱敏配置',
    'opts.enable': '启用脱敏',
    'opts.enableDesc': '开启后，访问命中候选集的网页会对文本（正文 + 表格）和图片做脱敏打码；鼠标悬停文本遮罩可临时查看原文。',
    'opts.ocrEnable': '图片 OCR 打码',
    'opts.ocrEnableDesc': '关闭后只做文本脱敏，不对图片做 OCR 识别打码（省去加载 OCR 模型）。',
    'opts.canvasEnable': 'Canvas 表格脱敏',
    'opts.canvasEnableDesc': '对 canvas 渲染的表格（如飞书电子表格）截图 OCR 识别后打码；仅对宽高均 ≥ 阈值的 canvas 生效，使用「全文」规则的识别规则。',
    'opts.canvasMinSize': '最小尺寸（宽 × 高，像素）',
    'opts.canvasMinSizeHint': '页面里的图表/logo 等也可能是 canvas，设大阈值可避免误伤',
    'opts.urlTitle': 'URL 候选集（命中才脱敏，每行一个）',
    'opts.urlDesc': '支持 host 或 host+路径，子路径自动兼容（如 example.com/foo 命中 example.com/foo/bar）。',
    'opts.urlPlaceholder': 'example.com\nadmin.example.com/login',
    'opts.ruleTitle': '脱敏规则（作用域 + 多条识别规则）',
    'opts.ruleDesc': '作用域：全文 = 页面正文 + 图片 OCR 识别；列名 = 表头命中则整列打码；列值 = 只扫表格列值。同一条规则内正则优先于词典。识别规则可配「保留前 N / 后 N」。',
    'opts.newRule': '＋ 新建脱敏规则',
    'opts.newRec': '＋ 识别规则',
    'opts.ruleName': '规则名称',
    'opts.scopeFull': '全文',
    'opts.scopeColName': '列名（整列）',
    'opts.scopeColValue': '列值',
    'opts.typeRegex': '正则',
    'opts.typeDict': '词典',
    'opts.dictPh': '词典词（每行一个）',
    'opts.regexPh': '正则表达式',
    'opts.keep': '前 / 后 保留 N',
    'opts.keepFirst': '保留前',
    'opts.keepLast': '保留后',
    'opts.keepHint': '保留前 N / 后 N 个字符；两者之和 ≥ 命中文本长度时等于不遮罩',
    'opts.delRule': '删除规则',
    'opts.delRec': '删除',
    'opts.save': '保存',
    'opts.saved': '已保存 ✓',
    'opts.empty': '暂无脱敏规则，点击「新建脱敏规则」添加',
    'opts.unnamed': '未命名规则',
    // JSON 配置
    'opts.jsonTitle': 'JSON 配置',
    'opts.jsonDesc': '以 JSON 形式查看 / 编辑 URL 与规则；编辑后自动应用到上方界面，也可导入 JSON 文件。',
    'opts.jsonApply': '应用',
    'opts.jsonImport': '导入文件',
    'opts.jsonCopy': '复制',
    'opts.jsonApplied': '已应用 JSON',
    'opts.jsonError': 'JSON 解析失败',
    'opts.jsonCopied': '已复制'
  },
  en: {
    'brand': 'MaskYourWeb',
    'popup.loading': 'Reading current page…',
    'popup.apply': 'Apply to this site',
    'popup.settings': 'Settings',
    'popup.applied': 'Applied',
    'popup.notApplied': 'Not applied',
    'popup.unknown': '(Cannot detect current page)',
    'opts.title': 'Web Masking Settings',
    'opts.enable': 'Enable masking',
    'opts.enableDesc': 'When enabled, pages matching the allowlist get masked (text in body/tables + images OCR-redacted); hover a text mask to reveal the original temporarily.',
    'opts.ocrEnable': 'Image OCR masking',
    'opts.ocrEnableDesc': 'When off, only text is masked; images are left untouched (skips loading the OCR model).',
    'opts.canvasEnable': 'Canvas table masking',
    'opts.canvasEnableDesc': 'Screenshot canvas-rendered tables (e.g. Feishu spreadsheets), OCR them, then mask matched text. Only canvases with width & height ≥ the threshold are scanned, using "Full text" recognizers.',
    'opts.canvasMinSize': 'Minimum size (width × height, px)',
    'opts.canvasMinSizeHint': 'Charts/logos are also canvases; raise the threshold to avoid over-masking.',
    'opts.urlTitle': 'URL allowlist (mask only when matched, one per line)',
    'opts.urlDesc': 'Supports host or host+path; sub-paths match automatically (e.g. example.com/foo matches example.com/foo/bar).',
    'opts.urlPlaceholder': 'example.com\nadmin.example.com/login',
    'opts.ruleTitle': 'Masking rules (scope + multiple recognizers)',
    'opts.ruleDesc': 'Scope: Full text = page body + image OCR; Column name = whole column when header matches; Column value = only table cell values. Regex wins over dict within a rule. Recognizers support "keep first/last N".',
    'opts.newRule': '+ New masking rule',
    'opts.newRec': '+ Recognizer',
    'opts.ruleName': 'Rule name',
    'opts.scopeFull': 'Full text',
    'opts.scopeColName': 'Column name',
    'opts.scopeColValue': 'Column value',
    'opts.typeRegex': 'Regex',
    'opts.typeDict': 'Dict',
    'opts.dictPh': 'Dict words (one per line)',
    'opts.regexPh': 'Regular expression',
    'opts.keep': 'Keep first/last N',
    'opts.keepFirst': 'Keep first',
    'opts.keepLast': 'Keep last',
    'opts.keepHint': 'Keep first/last N chars; if first+last ≥ match length, nothing is masked',
    'opts.delRule': 'Delete rule',
    'opts.delRec': 'Delete',
    'opts.save': 'Save',
    'opts.saved': 'Saved ✓',
    'opts.empty': 'No rules yet. Click "+ New masking rule" to add one.',
    'opts.unnamed': 'Unnamed rule',
    // JSON config
    'opts.jsonTitle': 'JSON Config',
    'opts.jsonDesc': 'View / edit URLs and rules as JSON; edits apply to the form above automatically. You can also import a JSON file.',
    'opts.jsonApply': 'Apply',
    'opts.jsonImport': 'Import',
    'opts.jsonCopy': 'Copy',
    'opts.jsonApplied': 'JSON applied',
    'opts.jsonError': 'Invalid JSON',
    'opts.jsonCopied': 'Copied'
  }
};

let LANG = 'zh';

async function loadLang() {
  try {
    const { lang } = await chrome.storage.sync.get('lang');
    LANG = lang === 'en' ? 'en' : 'zh';
  } catch (e) { LANG = 'zh'; }
}

function t(key) {
  return (I18N[LANG] && I18N[LANG][key]) ?? I18N.zh[key] ?? key;
}

function applyI18n() {
  document.documentElement.lang = LANG;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-lang-toggle]').forEach(el => {
    el.classList.toggle('active', LANG === el.dataset.langToggle);
  });
}

async function setLang(lang) {
  LANG = lang === 'en' ? 'en' : 'zh';
  try { await chrome.storage.sync.set({ lang: LANG }); } catch (e) {}
  applyI18n();
}

function bindLangToggles() {
  document.querySelectorAll('[data-lang-toggle]').forEach(el => {
    el.onclick = () => setLang(el.dataset.langToggle);
  });
}
