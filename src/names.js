// Botanical name formatting: genus, epithets and abbreviated genera of hybrid
// formulas in italics; authors, rank markers, × between parents, sp./cf./aff.
// in roman. naturedb mostly stores only the full string (author included), so
// the parts are recognised by shape.

export const escape = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// lowercase author particles that would otherwise look like epithets
const PARTICLES = new Set(['ex', 'et', 'in', 'de', 'del', 'der', 'da', 'dos', 'du', 'van', 'von', 'la', 'le', 'y', 'and']);

const EPITHET = /^×?[a-z][a-z-]*,?$/; // no dot: excludes var. f. sp. cf. aff.
const GENUS = /^×?[A-Z][a-z-]+$/; // not FAMILYNAME, not a stray 'sp.'
const ABBR_GENUS = /^[A-Z]\.$/; // "B." in "Begonia cirrosa × B. cavaleriei"

function isItalic(token, i, prev) {
  if (token === 'x') return false; // ASCII hybrid sign
  if (i === 0 && GENUS.test(token)) return !/aceae$/.test(token);
  if (i === 0 && ABBR_GENUS.test(token)) return true; // abbreviated genus
  if (EPITHET.test(token)) return !PARTICLES.has(token); // also a genus-less epithet
  return ABBR_GENUS.test(token) && (prev === '×' || prev === 'x');
}

// "Begonia metallica W.G. Sm." -> "B. metallica W.G. Sm."; the genus alone stays
export function abbreviateGenus(name, genus) {
  const n = (name || '').trim();
  return genus && n.startsWith(`${genus} `) ? `${genus[0]}. ${n.slice(genus.length + 1)}` : n;
}

export function scientificNameHtml(name) {
  const tokens = (name || '').trim().split(/\s+/).filter(Boolean);
  const out = [];
  let run = []; // consecutive italic tokens share one <i>
  const flush = () => {
    if (run.length) out.push(`<i>${run.map(escape).join(' ')}</i>`);
    run = [];
  };
  tokens.forEach((t, i) => {
    if (isItalic(t, i, tokens[i - 1])) {
      run.push(t);
    } else {
      flush();
      out.push(escape(t));
    }
  });
  flush();
  return out.join(' ');
}
