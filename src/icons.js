// Inline SVG icons, keyed by name (see config.basisOfRecord). Fixed strings,
// never API data, so they are safe to render with x-html. currentColor lets
// the surrounding badge (and theme) set the colour.

const svg = (body) =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export default {
  // living plant
  leaf: svg('<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>'),
  // herbarium sheet: a pressed specimen on paper
  sheet: svg('<rect x="5" y="2" width="14" height="20" rx="1.5"/><path d="M12 18V9"/><path d="M12 13c-2.5 0-3.5-1.5-3.5-3.5 2 0 3.5 1 3.5 3.5Z"/><path d="M12 11c2.5 0 3.5-1.5 3.5-3.5-2 0-3.5 1-3.5 3.5Z"/>'),
};
