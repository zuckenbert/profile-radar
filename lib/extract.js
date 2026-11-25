// Reader for LinkedIn's "Who viewed your profile" page. It only reads what is
// already rendered on screen. It does not rely on CSS class names (LinkedIn
// obfuscates them): it finds each card through its relative-time line
// ("Viewed 3d ago", "Visualizou há 3 d") and walks up to the card element.
(function (root) {
  const UNIT = '(min|mins|minuto|minutos|h|hr|hrs|hora|horas|d|dia|dias|w|wk|sem|semana|semanas|mo|mos|mês|mes|meses|m|yr|y|ano|anos)';
  const TIME_RE = new RegExp('^(viewed|visualiz\\w*|viu|visto|vista)\\b.{0,24}?(\\d+)\\s?' + UNIT + '\\b', 'i');
  const DEGREE_RE = /^[•·]?\s*(1st|2nd|3rd\+?|1º|2º|3º\+?|1er|2e|3e\+?)\b/i;
  const MUTUAL_RE = /\d+.*(mutual|em comum|en común)/i;

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const linesOf = (el) => (el.innerText || '').split('\n').map(clean).filter(Boolean);

  // Converts a relative-time line into hours ago. Returns null when the line
  // does not match. "m" means months in Portuguese/Spanish and minutes in English.
  function ageHours(raw, lang) {
    const m = String(raw || '').match(TIME_RE);
    if (!m) return null;
    const n = parseInt(m[2], 10);
    const u = m[3].toLowerCase();
    const pt = /^(pt|es)/i.test(lang || '');
    if (/^min/.test(u)) return n / 60;
    if (/^(h|hr|hrs|hora|horas)$/.test(u)) return n;
    if (/^(d|dia|dias)$/.test(u)) return n * 24;
    if (/^(w|wk|sem|semana|semanas)$/.test(u)) return n * 24 * 7;
    if (/^(mo|mos|mês|mes|meses)$/.test(u)) return n * 24 * 30;
    if (u === 'm') return pt ? n * 24 * 30 : n / 60;
    return n * 24 * 365;
  }

  // Profile slug from a link such as https://www.linkedin.com/in/<slug>/.
  function slugOf(href) {
    try {
      const m = new URL(href, 'https://www.linkedin.com').pathname.match(/^\/in\/([^/]+)/);
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) {
      return null;
    }
  }

  function findTimeEls(scope) {
    const out = [];
    scope.querySelectorAll('p, span, div, time').forEach((el) => {
      if (el.children.length) return;
      if (TIME_RE.test(clean(el.textContent))) out.push(el);
    });
    return out;
  }

  function extract(doc, now) {
    doc = doc || document;
    now = now || Date.now();
    const scope = doc.querySelector('main') || doc.body;
    const lang = doc.documentElement.lang || '';
    const timeEls = findTimeEls(scope);
    const timeSet = new Set(timeEls);
    const countIn = (el) => {
      let c = 0;
      timeSet.forEach((t) => { if (el.contains(t)) c++; });
      return c;
    };

    const viewers = [];
    const seen = new Set();
    timeEls.forEach((tEl) => {
      // Climb while the parent still holds exactly one time line: that is the card.
      let card = tEl;
      while (card.parentElement && card.parentElement !== scope && countIn(card.parentElement) === 1) {
        card = card.parentElement;
      }
      const viewedRaw = clean(tEl.textContent);
      const hours = ageHours(viewedRaw, lang);
      const viewedAt = hours == null ? null : new Date(now - hours * 3600e3).toISOString();
      const a = card.querySelector('a[href*="/in/"]');
      const lines = linesOf(a && a.contains(tEl) ? a : card);
      const iTime = lines.indexOf(viewedRaw);
      const before = iTime >= 0 ? lines.slice(0, iTime) : lines;
      const after = iTime >= 0 ? lines.slice(iTime + 1) : [];
      const mutual = after.find((l) => MUTUAL_RE.test(l)) || null;
      const img = card.querySelector('img');

      let rec;
      if (a && slugOf(a.href)) {
        const slug = slugOf(a.href);
        const degreeLine = before.find((l) => DEGREE_RE.test(l)) || '';
        const rest = before.filter((l) => l !== degreeLine);
        rec = {
          key: 'in:' + slug,
          kind: 'identified',
          name: rest[0] || null,
          slug,
          profile_url: 'https://www.linkedin.com/in/' + slug + '/',
          degree: (degreeLine.match(DEGREE_RE) || [])[1] || null,
          headline: rest.slice(1).join(' ') || null,
          photo: img && /^https:/.test(img.src) ? img.src : null,
        };
      } else {
        // Semi-private viewer: "Salesperson at Example Corp", "Someone at Acme".
        const desc = before[before.length - 1] || null;
        if (!desc) return;
        rec = {
          key: 'anon:' + desc.toLowerCase(),
          kind: 'anonymous',
          name: null,
          slug: null,
          profile_url: null,
          degree: null,
          headline: desc,
          photo: null,
        };
      }
      rec.viewed_raw = viewedRaw;
      rec.viewed_at = viewedAt;
      rec.age_hours = hours;
      rec.mutual = mutual;
      if (seen.has(rec.key)) return;
      seen.add(rec.key);
      viewers.push(rec);
    });

    // Total views in the period: first number-only line near the top of the page.
    let total = null;
    const top = linesOf(scope).slice(0, 25);
    for (const l of top) {
      if (/^\d[\d.,]*$/.test(l)) { total = parseInt(l.replace(/[.,]/g, ''), 10); break; }
    }
    const ages = viewers.map((v) => v.age_hours).filter((h) => h != null);
    return {
      viewers,
      total_period: total,
      oldest_hours: ages.length ? Math.max.apply(null, ages) : null,
      lang,
    };
  }

  root.ProfileRadar = { extract, ageHours, slugOf, TIME_RE };
})(typeof globalThis !== 'undefined' ? globalThis : this);
