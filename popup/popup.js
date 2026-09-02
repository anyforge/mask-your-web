// popup.js — macOS 风格卡片：应用于当前网页（switch toggle host）+ 配置入口
const $ = (sel) => document.getElementById(String(sel).replace(/^#/, ''));
function stripWww(host) { return String(host).toLowerCase().replace(/^www\./, ''); }

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
function hostOf(url) {
  try { return new URL(url).host; } catch { return ''; }
}
async function getConfig() {
  const { maskConfig } = await chrome.storage.sync.get('maskConfig');
  return maskConfig || { enabled: false, urls: [], rules: [] };
}
async function saveConfig(cfg) { await chrome.storage.sync.set({ maskConfig: cfg }); }

function candidateHost(cand) {
  try {
    let s = String(cand).trim();
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    return stripWww(new URL(s).host);
  } catch { return ''; }
}

async function refresh() {
  const tab = await getActiveTab();
  const host = hostOf(tab.url);
  const cfg = await getConfig();
  const applied = host ? (cfg.urls || []).some(c => candidateHost(c) === stripWww(host)) : false;
  $('host').textContent = host ? (host + '  ·  ' + t(applied ? 'popup.applied' : 'popup.notApplied')) : t('popup.unknown');
  $('toggle').checked = applied;
  $('toggle').disabled = !host;
}

$('toggle').onchange = async () => {
  const tab = await getActiveTab();
  const host = hostOf(tab.url);
  if (!host) return;
  const cfg = await getConfig();
  const h = stripWww(host);
  const applied = (cfg.urls || []).some(c => candidateHost(c) === h);
  if (applied) {
    cfg.urls = (cfg.urls || []).filter(c => candidateHost(c) !== h);
  } else {
    cfg.urls = (cfg.urls || []).concat([host]);
  }
  await saveConfig(cfg);
  chrome.tabs.reload(tab.id);
  window.close();
};

$('config').onclick = () => chrome.runtime.openOptionsPage();

async function init() {
  await loadLang();
  applyI18n();
  document.querySelectorAll('[data-lang-toggle]').forEach(el => {
    el.onclick = async () => { await setLang(el.dataset.langToggle); refresh(); };
  });
  refresh();
}
init();
