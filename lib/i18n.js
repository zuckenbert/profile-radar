// Tiny i18n helper for the popup and the options page.
// Inside the extension it uses chrome.i18n. When a page is opened directly as a
// file (demo mode) chrome.i18n does not exist, so it falls back to the English
// strings bundled in lib/messages-en.js.
(function (root) {
  const native = !!(root.chrome && root.chrome.i18n && root.chrome.i18n.getMessage);

  // Mirrors chrome.i18n substitution: $NAME$ -> placeholder content -> $1..$9.
  function fromFallback(key, subs) {
    const entry = (root.PROFILE_RADAR_EN || {})[key];
    if (!entry) return '';
    const args = subs == null ? [] : [].concat(subs).map(String);
    const ph = entry.placeholders || {};
    return entry.message
      .replace(/\$([A-Za-z0-9_@]+)\$/g, (m, name) => (ph[name.toLowerCase()] ? ph[name.toLowerCase()].content : m))
      .replace(/\$(\d)/g, (m, d) => (args[d - 1] != null ? args[d - 1] : ''))
      .replace(/\$\$/g, '$');
  }

  function t(key, subs) {
    if (native) {
      const s = root.chrome.i18n.getMessage(key, subs == null ? undefined : [].concat(subs).map(String));
      if (s) return s;
    }
    return fromFallback(key, subs);
  }

  // Fills [data-i18n] (text), [data-i18n-placeholder] and [data-i18n-aria-label].
  function apply(doc) {
    doc = doc || document;
    doc.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    doc.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    doc.querySelectorAll('[data-i18n-aria-label]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel)); });
    doc.documentElement.lang = native ? root.chrome.i18n.getUILanguage() : 'en';
  }

  root.I18n = { t, apply, fromFallback };
})(typeof globalThis !== 'undefined' ? globalThis : this);
