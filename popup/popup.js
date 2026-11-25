// Popup. Opening popup.html directly as a file (outside the extension) shows
// fictitious demo data, which is handy for working on the layout.
const DEMO = !(globalThis.chrome && chrome.storage);
const { t } = globalThis.I18n;
const $ = (id) => document.getElementById(id);
const H = 3600e3;
let tab = 'recent';
let data = { viewers: {}, state: {}, settings: {} };

function demoData() {
  const now = Date.now();
  const mk = (i, name, deg, headline, ageH, extra) => Object.assign({
    key: 'in:demo-' + i, kind: 'identified', name, degree: deg, headline, photo: null,
    profile_url: null, viewed_at: new Date(now - ageH * H).toISOString(),
    first_seen_at: now - ageH * H, visits: [1],
  }, extra || {});
  const list = [
    mk(1, 'Alex Kim', '2nd', 'Head of Product · Example Bank', 5),
    mk(2, 'Jordan Rivera', '1st', 'CTO · Sample Fintech', 26, { visits: [1, 2] }),
    { key: 'anon:demo', kind: 'anonymous', name: null, headline: 'Someone at Example Payments Co.', viewed_at: new Date(now - 50 * H).toISOString(), first_seen_at: now - 50 * H, visits: [1] },
    mk(3, 'Sam Patel', '2nd', 'VP of Operations · Demo Credit Union', 80),
    mk(4, 'Taylor Morgan', '3rd', 'Treasury Manager · Acme Logistics', 200),
    mk(5, 'Casey Nguyen', '2nd', 'Founder · Placeholder Labs', 340, { visits: [1, 2, 3] }),
  ];
  const viewers = {};
  list.forEach((v) => { viewers[v.key] = v; });
  return {
    viewers,
    settings: { endpoint: 'https://example.invalid/webhook' },
    state: { totalPeriod: 137, lastRun: { at: now - 2 * H, mode: 'daily', added: 2 }, outbox: ['in:demo-1', 'in:demo-2'] },
  };
}

async function load() {
  if (DEMO) return demoData();
  return chrome.storage.local.get({ viewers: {}, state: {}, settings: {} });
}

function ago(ts) {
  if (!ts) return '';
  const h = (Date.now() - new Date(ts).getTime()) / H;
  if (h < 1) return t('agoNow');
  if (h < 24) return t('agoHours', Math.round(h));
  const d = Math.round(h / 24);
  if (d < 14) return t('agoDays', d);
  if (d < 60) return t('agoWeeks', Math.round(d / 7));
  return t('agoMonths', Math.round(d / 30));
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function initials(name) {
  return (name || '?').split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase();
}

function row(v) {
  const r = el(v.profile_url ? 'a' : 'div', 'row');
  if (v.profile_url) { r.href = v.profile_url; r.target = '_blank'; r.rel = 'noopener'; }
  let av;
  if (v.photo) {
    av = el('img', 'avatar');
    av.src = v.photo;
    av.alt = '';
    av.onerror = () => av.replaceWith(el('div', 'avatar', initials(v.name)));
  } else {
    av = el('div', 'avatar', v.kind === 'anonymous' ? '?' : initials(v.name));
  }
  const who = el('div', 'who');
  const name = el('div', 'name', v.name || t('unnamedViewer'));
  if (v.degree) name.appendChild(el('span', 'deg', v.degree));
  who.appendChild(name);
  who.appendChild(el('div', 'head', v.headline || ''));
  const when = el('div', 'when');
  const nVisits = (v.visits || []).length;
  if (nVisits > 1) when.appendChild(el('div', 'tag', t('tagVisits', nVisits)));
  else if (Date.now() - (v.first_seen_at || 0) < 24 * H) when.appendChild(el('div', 'tag', t('tagNew')));
  when.appendChild(el('div', null, ago(v.viewed_at)));
  r.append(av, who, when);
  return r;
}

function render() {
  const all = Object.values(data.viewers).sort((a, b) => String(b.viewed_at || '').localeCompare(String(a.viewed_at || '')));
  const st = data.state || {};
  const week = all.filter((v) => Date.now() - new Date(v.viewed_at || 0).getTime() < 7 * 24 * H).length;
  $('n-week').textContent = week;
  $('n-stored').textContent = all.length;
  $('n-total').textContent = st.totalPeriod == null ? '·' : st.totalPeriod;
  $('sub').textContent = data.settings.owner ? t('popupSubOwner', data.settings.owner) : t('popupSub');

  const run = $('status-run');
  run.textContent = '';
  const dot = el('span', 'dot');
  let txt = t('statusNever');
  if (st.lastRun) {
    const errs = { logged_out: 'errLoggedOut', empty_list: 'errEmptyList', no_response: 'errNoResponse' };
    if (st.lastRun.error) {
      dot.classList.add('bad');
      txt = t(errs[st.lastRun.error] || 'errGeneric') + ' · ' + ago(st.lastRun.at);
    } else {
      dot.classList.add('ok');
      txt = t('statusLast', [ago(st.lastRun.at), st.lastRun.added || 0]);
    }
  }
  run.append(dot, document.createTextNode(txt));

  const pending = (st.outbox || []).length;
  let push = '';
  if (!data.settings.endpoint) push = all.length ? t('pushLocalOnly') : '';
  else if (st.lastPush && !st.lastPush.ok) push = t('pushRejected', st.lastPush.status || t('pushNetwork'));
  else push = pending ? t('pushQueued', pending) : t('pushUpToDate');
  $('status-push').textContent = push;

  const warn = $('warn');
  warn.hidden = true;
  warn.textContent = '';
  if (st.gap) {
    warn.hidden = false;
    warn.append(el('b', null, t('warnGapTitle')), document.createTextNode(' ' + t('warnGapBody')));
  }

  let shown = all;
  if (tab === 'recent') shown = all.filter((v) => v.kind !== 'anonymous');
  if (tab === 'returning') shown = all.filter((v) => (v.visits || []).length > 1);
  if (tab === 'anonymous') shown = all.filter((v) => v.kind === 'anonymous');
  const list = $('list');
  list.textContent = '';
  if (!shown.length) {
    const e = el('div', 'empty');
    const msg = {
      recent: ['emptyRecentTitle', 'emptyRecentBody'],
      returning: ['emptyReturningTitle', 'emptyReturningBody'],
      anonymous: ['emptyAnonymousTitle', 'emptyAnonymousBody'],
    }[tab];
    e.append(el('h3', null, t(msg[0])), el('p', null, t(msg[1])));
    list.appendChild(e);
  } else {
    shown.slice(0, 60).forEach((v) => list.appendChild(row(v)));
  }
}

function csv() {
  const cols = ['name', 'headline', 'degree', 'profile_url', 'kind', 'viewed_at', 'viewed_raw', 'mutual', 'first_seen_at', 'visits'];
  const esc = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  const rows = Object.values(data.viewers).map((v) => cols.map((c) => {
    if (c === 'visits') return esc((v.visits || []).length);
    if (c === 'first_seen_at') return esc(v.first_seen_at ? new Date(v.first_seen_at).toISOString() : '');
    return esc(v[c]);
  }).join(','));
  // The BOM lets spreadsheet apps detect UTF-8.
  const blob = new Blob(['﻿' + cols.join(',') + '\n' + rows.join('\n')], { type: 'text/csv' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'profile_radar_viewers_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
}

function setReading(on) {
  $('run').disabled = on;
  $('run').textContent = t(on ? 'btnReading' : 'btnReadNow');
}

globalThis.I18n.apply(document);
document.title = t('extName');
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
  tab = b.dataset.tab;
  document.querySelectorAll('.tab').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  render();
}));
$('csv').addEventListener('click', csv);
$('opts').addEventListener('click', (e) => { e.preventDefault(); if (!DEMO) chrome.runtime.openOptionsPage(); });
$('run').addEventListener('click', async () => {
  if (DEMO) return;
  setReading(true);
  await chrome.runtime.sendMessage({ type: 'run-now' });
});

(async function init() {
  data = await load();
  render();
  if (DEMO) return;
  chrome.runtime.sendMessage({ type: 'seen' });
  const st = await chrome.runtime.sendMessage({ type: 'status' });
  if (st && st.running) setReading(true);
  chrome.storage.onChanged.addListener(async () => {
    data = await load();
    render();
    const s = await chrome.runtime.sendMessage({ type: 'status' });
    if (!s || !s.running) setReading(false);
  });
})();
