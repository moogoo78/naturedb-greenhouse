import Alpine from 'alpinejs';
import config from './config.js';
import { get, AuthError, loginUrl, exportUrl, recordUrl, publicUrl } from './api.js';
import { abbreviateGenus, escape, scientificNameHtml } from './names.js';
import icons from './icons.js';
import './style.css';
import './theme-dads.css';

const THEME_KEY = 'naturedb-greenhouse:theme';
const NONE = '__none__'; // annotation filter: units with no value for the type
const FIELD_NUMBER_MAX = 2147483647; // open-ended range: field_number_int is an int column
const ALL = 'all';
const VIEWS = { unit: '/api/v1/units', record: '/api/v1/units/records' };

function emptyFilters() {
  return {
    q: '',
    collectorId: '',
    sectionId: '', // groupRank taxon id (e.g. Begonia section)
    taxon: null, // scientific name {id, name, rank}
    fieldNumber: '', // one collector number, exact
    fieldFrom: '',
    fieldTo: '',
    catalogNumber: '',
    locality: '',
    notes: '',
    status: '',
    annotations: {}, // {typeId: value | NONE}
  };
}

Alpine.data('greenhouse', () => ({
  config,
  theme: document.documentElement.dataset.theme || 'classic',
  user: null,
  collection: null, // the living collection (config.collectionName)
  sources: [], // config.sources with their collection resolved
  source: config.defaultSource, // a source key or ALL
  view: 'unit', // 'unit': a row per unit; 'record': a row per record with its units
  types: [], // unit annotation types shown as filters
  collectors: [], // [{value, label, count}] for the selected sources
  scope: { family: null, genus: null }, // resolved config.taxonomy taxa
  sections: [], // [{id, name}] groupRank taxa under the genus
  filters: emptyFilters(),
  applied: emptyFilters(), // snapshot of filters behind the current results
  sort: config.defaultSort,
  page: 0,
  rows: [],
  rowsView: 'unit', // the view `rows` were fetched for; the table renders by it
  searchSeq: 0, // only the latest search may apply its response
  total: 0,
  summary: null,
  sourceCounts: [], // [{key, unit, count}] per searched source
  facets: {}, // living-only facets: status + annotations
  loading: false,
  error: '',
  notice: '',
  preview: null, // {src, full, caption} of the open specimen image
  previewOpener: null, // element to return focus to
  taxonQuery: '',
  taxonOptions: [],

  async init() {
    try {
      this.user = await get('/api/v1/me');
      const byName = (name) => this.user.collections.find((c) => c.name === name);
      this.collection = byName(config.collectionName);
      const missing = [config.collectionName, ...config.sources.map((s) => s.collectionName)].filter((n) => !byName(n));
      if (missing.length) {
        this.error = `找不到 collection ${missing.map((n) => `"${n}"`).join(', ')}`;
        return;
      }
      this.sources = config.sources.map((s) => ({ ...s, collection: byName(s.collectionName) }));
      const cid = this.collection.id;
      const [types] = await Promise.all([
        get(`/api/v1/collections/${cid}/annotation-types`, { target: 'unit' }),
        this.loadTaxonomy(),
      ]);
      const wanted = config.annotationFacets;
      this.types = wanted.length
        ? wanted.map((name) => types.find((t) => t.name === name)).filter(Boolean)
        : types;
      await this.loadCollectors();

      window.addEventListener('hashchange', () => this.route());
      if (!(await this.route())) await this.search();
    } catch (e) {
      this.fail(e);
    }
  },

  // original layout vs. the Digital Agency design-system refresh; per browser
  setTheme(theme) {
    this.theme = theme;
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // private mode / blocked storage: the switch still works for this visit
    }
  },

  fail(e) {
    if (e instanceof AuthError) {
      window.location.href = loginUrl();
      return;
    }
    this.error = e.message;
  },

  // #/tag/<sn>: QR label lookup. Jumps straight to the record when unique.
  async route() {
    const m = window.location.hash.match(/^#\/tag\/(.+)$/);
    if (!m) return false;
    const sn = decodeURIComponent(m[1]).trim();
    if (this.source !== config.defaultSource) {
      this.source = config.defaultSource; // QR serials belong to the living collection
      await this.loadCollectors();
    }
    this.filters = { ...emptyFilters(), catalogNumber: sn };
    await this.search();
    if (this.total === 1) {
      window.location.href = recordUrl(this.rows[0].entity_key);
    } else {
      this.notice = this.total ? `流水號 ${sn} 有 ${this.total} 筆` : `找不到流水號 ${sn}`;
    }
    return true;
  },

  // --- sources ------------------------------------------------------------
  get activeSources() {
    return this.source === ALL ? this.sources : this.sources.filter((s) => s.key === this.source);
  },

  get hasLiving() {
    return this.activeSources.some((s) => s.living);
  },

  get mixed() {
    return this.activeSources.some((s) => !s.living);
  },

  get scopeHint() {
    const limited = this.activeSources.filter((s) => s.familyOnly).map((s) => s.label);
    return limited.length ? `${limited.join('、')}僅含 ${config.taxonomy.family}` : '';
  },

  sourceLabel(collectionId) {
    const s = this.sources.find((x) => x.collection.id === collectionId);
    return s ? s.label : '';
  },

  async setSource(key) {
    if (key === this.source) return;
    this.source = key;
    if (!this.hasLiving) {
      // greenhouse-only filters mean nothing for herbarium specimens
      Object.assign(this.filters, { catalogNumber: '', status: '', annotations: {} });
    }
    try {
      await this.loadCollectors();
    } catch (e) {
      this.fail(e);
    }
    this.submit();
  },

  // collectors of the selected sources (their scope, no other filters)
  async loadCollectors() {
    const res = await get('/api/v1/units/facets', {
      filter: this.scopeFilter(this.activeSources, {}),
      fields: 'collector',
      limit: 1000,
    });
    this.collectors = res.facets.collector.filter((x) => x.value !== null);
    const keep = this.collectors.some((c) => String(c.value) === String(this.filters.collectorId));
    if (!keep) this.filters.collectorId = '';
  },

  // sources' scopes OR-ed (`any`), each a sub-filter: living sources take the
  // living filters, the others are limited to the family. Common filters stay at
  // the top so they never replace a sub-filter's own taxon scope.
  scopeFilter(sources, living) {
    const hasLivingFilter = Object.keys(living).length > 0;
    const picked = hasLivingFilter ? sources.filter((s) => s.living) : sources;
    return {
      collection_id: picked.map((s) => s.collection.id),
      any: picked.map((s) => {
        const sub = { collection_id: s.collection.id };
        if (s.living) Object.assign(sub, living);
        if (s.familyOnly) sub.taxon_id = [this.scope.family.id];
        return sub;
      }),
    };
  },

  livingFilter() {
    const f = this.filters;
    const out = {};
    if (f.catalogNumber.trim()) out.catalog_number = f.catalogNumber.trim();
    if (f.status) out.disposition = config.status[f.status].disposition;
    const ann = {};
    for (const t of this.types) {
      const v = f.annotations[t.id];
      if (v === NONE) ann[t.id] = { not: t.options.map((o) => o[0]) };
      else if (v) ann[t.id] = [v];
    }
    if (Object.keys(ann).length) out.annotations = ann;
    return out;
  },

  apiFilter(sources = this.activeSources) {
    const f = this.filters;
    const out = this.scopeFilter(sources, this.livingFilter());
    if (f.q.trim()) out.q = f.q.trim();
    if (f.collectorId) out.collector_id = [Number(f.collectorId)];
    // taxon_id is OR on the server: send only the most specific one. The name
    // picker is scoped to the selected section, so the name implies it.
    if (f.taxon) out.taxon_id = [f.taxon.id];
    else if (f.sectionId) out.taxon_id = [Number(f.sectionId)];
    // field_number specs are AND-ed: the exact number and the range together
    const fieldNumber = [];
    if (f.fieldNumber.trim()) fieldNumber.push(f.fieldNumber.trim());
    if (f.fieldFrom || f.fieldTo) fieldNumber.push(`${f.fieldFrom || 0}--${f.fieldTo || FIELD_NUMBER_MAX}`);
    if (fieldNumber.length) out.field_number = fieldNumber;
    if (f.locality.trim()) out.locality = f.locality.trim();
    if (f.notes.trim()) out.notes = f.notes.trim();
    return out;
  },

  async search(page = 0) {
    if (!this.collection) return;
    const seq = ++this.searchSeq;
    const view = this.view;
    this.loading = true;
    this.error = '';
    this.page = page;
    this.applied = JSON.parse(JSON.stringify(this.filters));
    const filter = this.apiFilter();
    const start = page * config.pageSize;
    try {
      // status/annotation counts over the living sources only: a herbarium sheet
      // is neither alive nor in a room
      // (without other sources the main filter is the living one: one request)
      const living = this.activeSources.filter((s) => s.living);
      const livingFields = [...this.types.map((t) => `annotation:${t.id}`), 'disposition'];
      const [list, main, livingFacets] = await Promise.all([
        get(VIEWS[view], { filter, sort: this.sort, range: [start, start + config.pageSize] }),
        get('/api/v1/units/facets', {
          filter,
          fields: ['collection', ...(this.mixed ? [] : livingFields)].join(','),
        }),
        this.mixed && living.length
          ? get('/api/v1/units/facets', { filter: this.apiFilter(living), fields: livingFields.join(',') })
          : null,
      ]);
      if (seq !== this.searchSeq) return; // a newer search is running
      this.rows = list.data;
      this.rowsView = view;
      this.total = list.total;
      this.facets = this.mixed ? (livingFacets ? livingFacets.facets : {}) : main.facets;
      this.summary = main.summary;
      const counts = new Map(main.facets.collection.map((x) => [x.value, x.count]));
      this.sourceCounts = this.activeSources.map((s) => ({ key: s.key, unit: s.unit, count: counts.get(s.collection.id) || 0 }));
    } catch (e) {
      if (seq === this.searchSeq) this.fail(e);
    } finally {
      if (seq === this.searchSeq) this.loading = false;
    }
  },

  submit() {
    this.notice = '';
    if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search);
    this.search(0);
  },

  reset() {
    this.filters = emptyFilters();
    this.taxonQuery = '';
    this.submit();
  },

  // --- taxon filters (naturedb's taxa search) -----------------------------
  // Names repeat across taxon trees (and case varies), so look them up inside
  // the collection's tree and keep only an exact, case-insensitive match.
  async findTaxon(name, rank, parentId) {
    const filter = { q: name, rank, collection_id: this.collection.id };
    if (parentId) filter.parent_id = parentId;
    const res = await get('/api/v1/taxa', { filter, range: [0, 20] });
    return res.data.find((t) => t.full_scientific_name.toLowerCase() === name.toLowerCase()) || null;
  },

  async loadTaxonomy() {
    const { family, genus, groupRank } = config.taxonomy;
    this.scope.family = await this.findTaxon(family, 'family');
    if (!this.scope.family) throw new Error(`找不到科 ${family}`);
    this.scope.genus = await this.findTaxon(genus, 'genus', this.scope.family.id);
    if (!this.scope.genus) throw new Error(`找不到屬 ${genus}`);
    const res = await get('/api/v1/taxa', {
      filter: { rank: groupRank, parent_id: this.scope.genus.id, collection_id: this.collection.id },
      range: [0, 500],
    });
    this.sections = res.data
      .map((t) => ({ id: t.id, name: t.full_scientific_name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  sectionName(id) {
    const s = this.sections.find((x) => String(x.id) === String(id));
    return s ? s.name.replace(/^.*\bsect\.\s*/, '') : '';
  },

  pickSection() {
    this.filters.taxon = null; // a name from another section would contradict it
    this.submit();
  },

  async searchTaxa() {
    const q = this.taxonQuery.trim();
    if (q.length < 2) {
      this.taxonOptions = [];
      return;
    }
    const parentId = this.filters.sectionId ? Number(this.filters.sectionId) : this.scope.family.id;
    try {
      const res = await get('/api/v1/taxa', {
        filter: { q, parent_id: parentId, collection_id: this.collection.id },
        range: [0, 15],
      });
      this.taxonOptions = res.data;
    } catch (e) {
      this.fail(e);
    }
  },

  // picker label: abbreviated genus, italics, common name
  taxonLabel(t) {
    const name = scientificNameHtml(abbreviateGenus(t.full_scientific_name, config.taxonomy.genus));
    return t.common_name ? `${name} <small>${escape(t.common_name)}</small>` : name;
  },

  pickTaxon(t) {
    this.filters.taxon = { id: t.id, name: t.display_name, label: this.taxonLabel(t), rank: t.rank };
    this.taxonQuery = '';
    this.taxonOptions = [];
    this.submit();
  },

  clearTaxon() {
    this.filters.taxon = null;
    this.submit();
  },

  // --- facets -------------------------------------------------------------
  facetItems(type) {
    const counts = new Map((this.facets[`annotation:${type.id}`] || []).map((x) => [x.value, x.count]));
    const items = type.options.map(([value, label]) => ({ value, label, count: counts.get(value) || 0 }));
    if (counts.get(null)) items.push({ value: NONE, label: '未填', count: counts.get(null) });
    return items;
  },

  facetMax(type) {
    return Math.max(1, ...this.facetItems(type).map((x) => x.count));
  },

  toggleAnnotation(type, value) {
    const cur = this.filters.annotations[type.id];
    this.filters.annotations = { ...this.filters.annotations, [type.id]: cur === value ? '' : value };
    this.submit();
  },

  statusCount(key) {
    const items = this.facets.disposition || [];
    const dead = config.status.dead.disposition;
    const n = (pred) => items.filter(pred).reduce((s, x) => s + x.count, 0);
    return key === 'dead' ? n((x) => x.value === dead) : n((x) => x.value !== dead);
  },

  // --- table --------------------------------------------------------------
  setView(view) {
    if (view === this.view) return;
    this.view = view;
    this.search(0);
  },

  // by rowsView, not view: after a view switch the old rows stay until the new
  // ones arrive, and must keep the columns they have the fields for
  get columns() {
    return config.columns.filter(
      (c) => (!c.view || c.view === this.rowsView) && (!c.source || this.source === ALL) && (!c.image || this.mixed),
    );
  },

  isLink(col) {
    return col.link === this.rowsView;
  },

  // --- record view: a record's units as chips ------------------------------
  unitSource(u) {
    return this.sources.find((s) => s.collection.id === u.collection_id);
  },

  isDead(u) {
    return u.disposition === config.status.dead.disposition;
  },

  chipLabel(u) {
    const s = this.unitSource(u);
    const number = u.catalog_number || '—';
    if (!s || !s.living) return `館號 ${number}`;
    const a = config.unitChip.annotation;
    const type = this.types.find((t) => t.name === a);
    const v = (a && u.annotations[a]) || '';
    const opt = type && type.options.find((o) => o[0] === v);
    return v ? `${number} · ${opt ? opt[1] : v}` : number;
  },

  chipTitle(u) {
    const s = this.unitSource(u);
    return [s && s.label, this.chipLabel(u), this.isDead(u) && config.status.dead.label].filter(Boolean).join(' · ');
  },

  // "8 株 · 1 件"
  unitCounts(row) {
    return this.activeSources
      .map((s) => [s, row.units.filter((u) => u.collection_id === s.collection.id).length])
      .filter(([, n]) => n)
      .map(([s, n]) => `${n} ${s.unit.label}`)
      .join(' · ');
  },

  imageUrl(row, size) {
    return row.cover_image_url ? config.image.size(row.cover_image_url, size) : '';
  },

  openImage(row, opener) {
    this.previewOpener = opener;
    this.preview = {
      src: this.imageUrl(row, config.image.preview),
      full: this.imageUrl(row, config.image.full),
      caption: [row.catalog_number, row.taxon && row.taxon.scientific_name].filter(Boolean).join(' · '),
    };
    this.$nextTick(() => this.$refs.previewClose && this.$refs.previewClose.focus());
  },

  closeImage() {
    if (!this.preview) return;
    this.preview = null;
    if (this.previewOpener) this.previewOpener.focus();
  },

  colLabel(col) {
    return this.mixed && col.mixedLabel ? col.mixedLabel : col.label;
  },

  // a badge column's value (e.g. basis_of_record) as icon + tooltip
  badge(col, row) {
    return this.basisBadge(col.badge(row));
  },

  // basis_of_record -> { svg, label, title, className }; values missing from
  // config.basisOfRecord fall back to the raw text
  basisBadge(value = '') {
    const b = config.basisOfRecord[value];
    if (!b) return { svg: '', label: value, title: value, className: '' };
    return { svg: icons[b.icon] || '', label: b.label, title: `${value} · ${b.label}`, className: b.className };
  },

  cell(col, row) {
    if (col.badge) return col.badge(row) || '';
    if (col.source) return this.sourceLabel(row.collection_id);
    if (col.annotation) {
      const v = row.annotations[col.annotation] || '';
      const type = this.types.find((t) => t.name === col.annotation);
      const opt = type && type.options.find((o) => o[0] === v);
      return opt ? opt[1] : v;
    }
    return col.value(row) || '';
  },

  // click-to-filter cells: only when the row links to a person / taxon
  canFilter(col, row) {
    if (col.filter === 'collector') return Boolean(row.collector && row.collector.id);
    if (col.filter === 'taxon') return Boolean(row.taxon && row.taxon.id);
    return false;
  },

  applyCellFilter(col, row) {
    if (col.filter === 'collector') {
      this.filters.collectorId = String(row.collector.id);
    } else if (col.filter === 'taxon') {
      // the row is already inside the selected section, so keep it
      const t = { full_scientific_name: row.taxon.scientific_name, common_name: row.taxon.common_name };
      this.filters.taxon = { id: row.taxon.id, name: row.taxon.scientific_name, label: this.taxonLabel(t), rank: '' };
      this.taxonQuery = '';
      this.taxonOptions = [];
    }
    this.submit();
  },

  setSort(col) {
    if (!col.sort) return;
    this.sort = this.sort === col.sort ? `-${col.sort}` : col.sort;
    this.search(0);
  },

  sortMark(col) {
    if (this.sort === col.sort) return '▲';
    if (this.sort === `-${col.sort}`) return '▼';
    return '';
  },

  get pages() {
    return Math.max(1, Math.ceil(this.total / config.pageSize));
  },

  // --- applied-filter chips -------------------------------------------------
  get activeFilters() {
    const f = this.applied;
    const out = [];
    const add = (key, label, value, html = false) => out.push({ key, label, value, html });
    // same order as the form
    if (f.q.trim()) add('q', '關鍵字', f.q.trim());
    if (f.collectorId) {
      const c = this.collectors.find((x) => String(x.value) === String(f.collectorId));
      add('collectorId', '採集者', c ? c.label || c.value : f.collectorId);
    }
    if (f.fieldNumber.trim()) add('fieldNumber', '採集號', f.fieldNumber.trim());
    if (f.fieldFrom || f.fieldTo) add('field', '採集號範圍', `${f.fieldFrom || '…'}–${f.fieldTo || '…'}`);
    if (f.catalogNumber.trim()) add('catalogNumber', '流水號', f.catalogNumber.trim());
    if (f.sectionId) add('sectionId', config.taxonomy.groupLabel, this.sectionName(f.sectionId));
    if (f.taxon) add('taxon', '學名', f.taxon.label || escape(f.taxon.name), true);
    if (f.locality.trim()) add('locality', '地點', f.locality.trim());
    if (f.notes.trim()) add('notes', '備註', f.notes.trim());
    if (f.status) add('status', '狀態', config.status[f.status].label);
    for (const t of this.types) {
      const v = f.annotations[t.id];
      if (!v) continue;
      const opt = t.options.find((o) => o[0] === v);
      add(`annotation:${t.id}`, t.label || t.name, v === NONE ? '未填' : opt ? opt[1] : v);
    }
    return out;
  },

  removeFilter(key) {
    const f = this.filters;
    if (key.startsWith('annotation:')) {
      f.annotations = { ...f.annotations, [key.slice(11)]: '' };
    } else if (key === 'field') {
      f.fieldFrom = '';
      f.fieldTo = '';
    } else {
      f[key] = emptyFilters()[key];
    }
    this.submit();
  },

  recordUrl,
  publicUrl,
  externalIcon: icons.external,

  exportHref(format) {
    return this.collection ? exportUrl(this.apiFilter(), format, this.sort) : '#';
  },
}));

window.Alpine = Alpine;
Alpine.start();
