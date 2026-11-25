// Settings page. Saving an endpoint asks Chrome for the optional host permission of its origin.
const DEFAULTS = { enabled: true, owner: '', hourFrom: 9, hourTo: 18, endpoint: '', token: '' };
const { t } = globalThis.I18n;
const $ = (id) => document.getElementById(id);
const say = (text) => { $('msg').textContent = text; };

globalThis.I18n.apply(document);
document.title = t('extName') + ' · ' + t('optionsHeading');

(async function init() {
  const s = Object.assign({}, DEFAULTS, (await chrome.storage.local.get({ settings: {} })).settings);
  $('enabled').checked = s.enabled;
  ['owner', 'hourFrom', 'hourTo', 'endpoint', 'token'].forEach((k) => { $(k).value = s[k]; });
})();

$('save').addEventListener('click', async () => {
  const endpoint = $('endpoint').value.trim();
  if (endpoint) {
    let origin;
    try { origin = new URL(endpoint).origin; } catch (e) { return say(t('msgInvalidUrl')); }
    if (!/^https:/.test(origin)) return say(t('msgNeedHttps'));
    const ok = await chrome.permissions.request({ origins: [origin + '/*'] });
    if (!ok) return say(t('msgNoPermission'));
  }
  const hourFrom = Math.min(23, Math.max(0, parseInt($('hourFrom').value, 10) || 0));
  const hourTo = Math.min(24, Math.max(hourFrom + 1, parseInt($('hourTo').value, 10) || 24));
  await chrome.storage.local.set({ settings: {
    enabled: $('enabled').checked, owner: $('owner').value.trim(), hourFrom, hourTo, endpoint, token: $('token').value.trim(),
  } });
  $('hourFrom').value = hourFrom;
  $('hourTo').value = hourTo;
  say(t('msgSaved'));
});

$('flush').addEventListener('click', async () => {
  say(t('msgSending'));
  const r = await chrome.runtime.sendMessage({ type: 'flush' });
  if (!r) return say(t('msgNoResponse'));
  if (r.ok && r.n) return say(t('msgSent', r.n));
  if (r.ok) return say(t('msgNothing'));
  if (r.pending) return say(t('msgNoEndpoint', r.pending));
  say(t('msgRejected', r.status || t('msgNoNetwork')));
});
