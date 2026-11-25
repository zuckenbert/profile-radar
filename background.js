// Profile Radar service worker: schedules the daily read, merges what the reader
// sends back, detects revisits and posts new viewers to the optional endpoint.
const URL_VIEWS = 'https://www.linkedin.com/analytics/profile-views/';
const DEFAULTS = { enabled: true, owner: '', hourFrom: 9, hourTo: 18, endpoint: '', token: '' };
const MAX_VISITS_PER_BATCH = 400;
const TICK_MINUTES = 20;

const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD in the local time zone
const get = async (k, d) => (await chrome.storage.local.get({ [k]: d }))[k];
const set = (k, v) => chrome.storage.local.set({ [k]: v });
const getSettings = async () => Object.assign({}, DEFAULTS, await get('settings', {}));
const getJob = async () => (await chrome.storage.session.get({ job: null })).job;
const setJob = (job) => chrome.storage.session.set({ job });

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('tick', { periodInMinutes: TICK_MINUTES, delayInMinutes: 1 });
  chrome.action.setBadgeBackgroundColor({ color: '#0E7C6B' });
  if (chrome.action.setBadgeTextColor) chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
});
chrome.runtime.onStartup.addListener(() => chrome.alarms.create('tick', { periodInMinutes: TICK_MINUTES, delayInMinutes: 1 }));

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'tick') return tick();
  if (alarm.name === 'job-timeout') return finishJob({ error: 'no_response' });
});

async function tick() {
  const s = await getSettings();
  const state = await get('state', {});
  // Every tick also retries the outbox, so a failed POST is retried every TICK_MINUTES.
  await flushOutbox();
  if (!s.enabled) return;
  // First backfill: runs by itself right after install (one attempt per day, at most 3).
  if (!state.backfillDone) {
    if (state.backfillDay === today() || (state.backfillTries || 0) >= 3) return;
    state.backfillDay = today();
    state.backfillTries = (state.backfillTries || 0) + 1;
    await set('state', state);
    return startJob('full');
  }
  if (state.lastRunDay === today()) return;
  const now = new Date();
  if (state.plannedDay !== today()) {
    if (now.getHours() < s.hourFrom || now.getHours() >= s.hourTo) return;
    // Random time inside the window, so the read does not happen at the same minute every day.
    state.plannedDay = today();
    state.plannedAt = Date.now() + Math.random() * 90 * 60e3;
    await set('state', state);
    return;
  }
  if (Date.now() < state.plannedAt) return;
  // Prefer reading while LinkedIn is already open; if nobody opens it within 3 hours, read anyway.
  const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
  if (!tabs.length && Date.now() < state.plannedAt + 3 * 3600e3) return;
  await startJob('daily');
}

async function startJob(mode, catchUpHours) {
  if (await getJob()) return { ok: false, error: 'already_running' };
  const state = await get('state', {});
  const sinceH = state.lastOkAt ? (Date.now() - state.lastOkAt) / 3600e3 : null;
  const params = mode === 'full'
    ? { mode, maxPages: catchUpHours ? 12 : 45, untilHours: catchUpHours || null }
    : { mode, maxPages: 3, untilHours: sinceH == null ? 24 * 7 : sinceH + 48 };
  const tab = await chrome.tabs.create({ url: URL_VIEWS, active: mode === 'full' });
  await setJob({ tabId: tab.id, startedAt: Date.now(), params, added: 0, read: 0 });
  chrome.alarms.create('job-timeout', { delayInMinutes: mode === 'full' ? 6 : 3 });
  return { ok: true };
}

async function finishJob(extra) {
  const job = await getJob();
  if (!job) return;
  await setJob(null);
  chrome.alarms.clear('job-timeout');
  chrome.tabs.remove(job.tabId).catch(() => null);
  const state = await get('state', {});
  const prevOkAt = state.lastOkAt;
  state.lastRun = Object.assign({ at: Date.now(), mode: job.params.mode, read: job.read, added: job.added }, extra || {});
  if (!state.lastRun.error) {
    state.lastRunDay = today();
    state.lastOkAt = Date.now();
  } else if (job.params.mode === 'daily') {
    state.lastRunDay = today(); // do not hammer on errors: try again tomorrow
  }
  if (!state.lastRun.error && job.params.mode === 'full') state.backfillDone = true;
  const catchUp = job.params.mode === 'daily' && !state.lastRun.error && state.gap;
  await set('state', state);
  // The background tab only brought the first batch and all of it was new: complete it in the foreground.
  if (catchUp) return startJob('full', (prevOkAt ? (Date.now() - prevOkAt) / 3600e3 : 24 * 7) + 48);
  await flushOutbox();
}

async function merge(result, mode) {
  const viewers = await get('viewers', {});
  const state = await get('state', {});
  const outbox = new Set(state.outbox || []);
  const now = Date.now();
  let added = 0;
  for (const v of result.viewers || []) {
    const cur = viewers[v.key];
    if (!cur) {
      viewers[v.key] = Object.assign({}, v, { first_seen_at: now, last_seen_at: now, visits: v.viewed_at ? [v.viewed_at] : [] });
      delete viewers[v.key].age_hours;
      added++;
      outbox.add(v.key);
      continue;
    }
    const lastVisit = cur.visits && cur.visits.length ? Date.parse(cur.visits[cur.visits.length - 1]) : 0;
    // Revisit: shows up again as recent and the previous visit was more than 5 days ago.
    const revisit = v.age_hours != null && v.age_hours < 72 && now - lastVisit > 5 * 24 * 3600e3;
    ['name', 'degree', 'headline', 'photo', 'profile_url', 'mutual'].forEach((k) => { if (v[k]) cur[k] = v[k]; });
    cur.viewed_raw = v.viewed_raw;
    cur.last_seen_at = now;
    if (revisit) {
      cur.visits = (cur.visits || []).concat(v.viewed_at);
      cur.viewed_at = v.viewed_at;
      added++;
      outbox.add(v.key);
    }
  }
  state.outbox = Array.from(outbox);
  if (result.total_period != null) state.totalPeriod = result.total_period;
  state.unseen = (state.unseen || 0) + added;
  // A daily read where everything was new: people may have been left behind.
  if (mode === 'daily') state.gap = (result.viewers || []).length >= 10 && added >= (result.viewers || []).length;
  if (mode === 'full') state.gap = false;
  await set('viewers', viewers);
  await set('state', state);
  chrome.action.setBadgeText({ text: state.unseen ? String(state.unseen) : '' });
  return added;
}

async function flushOutbox() {
  const s = await getSettings();
  const state = await get('state', {});
  const keys = state.outbox || [];
  if (!s.endpoint || !keys.length) return { ok: !keys.length, pending: keys.length };
  const viewers = await get('viewers', {});
  // Payload documented in README.md: bounded fields, at most MAX_VISITS_PER_BATCH visits per request.
  const cut = (v, n) => (v == null ? null : String(v).slice(0, n));
  const batch = [];
  let lines = 0;
  for (const k of keys) {
    const v = viewers[k];
    if (!v) { batch.push({ k, item: null }); continue; }
    const visits = (v.visits && v.visits.length ? v.visits : [v.viewed_at]).filter(Boolean);
    if (!visits.length) { batch.push({ k, item: null }); continue; }
    if (lines + visits.length > MAX_VISITS_PER_BATCH) break;
    lines += visits.length;
    batch.push({ k, item: {
      key: cut(v.key, 400),
      kind: v.kind === 'anonymous' ? 'anonymous' : 'identified',
      slug: v.kind === 'anonymous' ? null : String(v.slug || '').toLowerCase(),
      name: cut(v.name, 300),
      headline: cut(v.headline, 300),
      degree: cut(v.degree, 120),
      mutual: cut(v.mutual, 120),
      viewed_text: cut(v.viewed_raw, 120),
      visits,
    } });
  }
  const sent = batch.map((b) => b.k);
  const body = {
    source: 'linkedin_profile_views',
    extension_version: chrome.runtime.getManifest().version,
    total_period: state.totalPeriod == null ? null : state.totalPeriod,
    viewers: batch.map((b) => b.item).filter(Boolean),
  };
  let push;
  if (!body.viewers.length) {
    push = { at: Date.now(), ok: true, status: 0, n: 0 };
  } else {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (s.token) headers.Authorization = 'Bearer ' + s.token;
      const res = await fetch(s.endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
      push = { at: Date.now(), ok: res.ok, status: res.status, n: body.viewers.length };
    } catch (e) {
      push = { at: Date.now(), ok: false, status: 0, n: body.viewers.length, error: String(e.message || e) };
    }
  }
  const fresh = await get('state', {});
  fresh.lastPush = push;
  if (push.ok) fresh.outbox = (fresh.outbox || []).filter((k) => !sent.includes(k));
  await set('state', fresh);
  // Queue left over and the request went through: send the next batch.
  if (push.ok && sent.length && fresh.outbox.length) return flushOutbox();
  return push;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const job = await getJob();
    const mine = job && sender.tab && sender.tab.id === job.tabId;
    if (msg.type === 'ready') return mine ? job.params : { mode: 'passive' };
    if (msg.type === 'viewers') {
      const mode = mine ? job.params.mode : 'passive';
      const added = await merge(msg.result || {}, mode);
      if (mine) {
        job.added += added;
        job.read = ((msg.result && msg.result.viewers) || []).length;
        await setJob(job);
        if (msg.done) await finishJob(msg.error ? { error: msg.error } : null);
      }
      return { ok: true, added };
    }
    if (msg.type === 'run-now') return startJob('full');
    if (msg.type === 'flush') return flushOutbox();
    if (msg.type === 'seen') {
      const state = await get('state', {});
      state.unseen = 0;
      await set('state', state);
      chrome.action.setBadgeText({ text: '' });
      return { ok: true };
    }
    if (msg.type === 'status') return { running: !!job };
    return null;
  })().then(sendResponse);
  return true;
});
