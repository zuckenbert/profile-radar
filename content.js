// Runs only on linkedin.com/analytics/profile-views. Three modes, chosen by the background worker:
//  passive: the owner opened the page; read whatever they load, never scroll.
//  daily:   tab opened by the extension; read the first batch and scroll a little.
//  full:    first backfill, catch-up or the "Read now" button; scroll to the end of the period.
(function () {
  const R = globalThis.ProfileRadar;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = (a, b) => a + Math.random() * (b - a);
  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);

  async function waitForList(maxMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      if (R.extract(document).viewers.length) return true;
      await sleep(800);
    }
    return false;
  }

  async function scrollAndCollect(job) {
    const main = document.querySelector('main');
    let last = R.extract(document);
    let stale = 0;
    let pages = 0;
    while (main && pages < job.maxPages && stale < 2) {
      if (job.untilHours && last.oldest_hours != null && last.oldest_hours > job.untilHours) break;
      main.scrollTo({ top: main.scrollHeight, behavior: document.hidden ? 'auto' : 'smooth' });
      await sleep(jitter(1800, 3600));
      const cur = R.extract(document);
      stale = cur.viewers.length > last.viewers.length ? 0 : stale + 1;
      last = cur;
      pages++;
    }
    return last;
  }

  function watchPassive() {
    let timer = null;
    let lastCount = 0;
    const flush = () => {
      const res = R.extract(document);
      if (res.viewers.length === lastCount) return;
      lastCount = res.viewers.length;
      send({ type: 'viewers', mode: 'passive', done: false, result: res });
    };
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(flush, 2000);
    }).observe(document.body, { childList: true, subtree: true });
    flush();
  }

  (async function start() {
    const job = (await send({ type: 'ready' })) || { mode: 'passive' };
    const ok = await waitForList(25000);
    if (!ok) {
      const loggedOut = /\/(login|checkpoint|authwall|uas)\b/.test(location.pathname);
      send({ type: 'viewers', mode: job.mode, done: true, error: loggedOut ? 'logged_out' : 'empty_list', result: R.extract(document) });
      return;
    }
    if (job.mode === 'passive') return watchPassive();
    await sleep(jitter(1200, 2600));
    const res = await scrollAndCollect(job);
    send({ type: 'viewers', mode: job.mode, done: true, result: res });
  })();
})();
