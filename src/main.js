import Alpine from 'alpinejs';
import config from './config.js';
import { get, AuthError, loginUrl, exportUrl, recordUrl } from './api.js';
import { abbreviateGenus, escape, scientificNameHtml } from './names.js';
import './style.css';

const NONE = '__none__'; // annotation filter: units with no value for the type

function emptyFilters() {
  return {
    q: '',
    collectorId: '',
    sectionId: '', // groupRank taxon id (e.g. Begonia section)
    taxon: null, // scientific name {id, name, rank}
    fieldFrom: '',
    fieldTo: '',
    catalogNumber: '',
    status: '',
    annotations: {}, // {typeId: value | NONE}
  };
}

Alpine.data('greenhouse', () => ({
  config,
  user: null,
  collection: null,
  types: [], // unit annotation types shown as filters
  collectors: [], // [{value, label, count}] for the whole collection
  scope: { family: null, genus: null }, // resolved config.taxonomy taxa
  sections: [], // [{id, name}] groupRank taxa under the genus
  filters: emptyFilters(),
  applied: emptyFilters(), // snapshot of filters behind the current results
  sort: config.defaultSort,
  page: 0,
  rows: [],
  total: 0,
  summary: null,
  facets: {},
  loading: false,
  error: '',
  notice: '',
  taxonQuery: '',
  taxonOptions: [],

  async init() {
    try {
      this.user = await get('/api/v1/me');
      this.collection = this.user.collections.find((c) => c.name === config.collectionName);
      if (!this.collection) {
        this.error = `找不到 collection "${config.collectionName}"`;
        return;
      }
      const cid = this.collection.id;
      const [types, base] = await Promise.all([
        get(`/api/v1/collections/${cid}/annotation-types`, { target: 'unit' }),
        get('/api/v1/units/facets', { filter: { collection_id: cid }, fields: 'collector', limit: 1000 }),
        this.loadTaxonomy(),
      ]);
      const wanted = config.annotationFacets;
      this.types = wanted.length
        ? wanted.map((name) => types.find((t) => t.name === name)).filter(Boolean)
        : types;
      this.collectors = base.facets.collector.filter((x) => x.value !== null);

      window.addEventListener('hashchange', () => this.route());
      if (!(await this.route())) await this.search();
    } catch (e) {
      this.fail(e);
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
    this.filters = { ...emptyFilters(), catalogNumber: sn };
    await this.search();
    if (this.total === 1) {
      window.location.href = recordUrl(this.rows[0].entity_key);
    } else {
      this.notice = this.total ? `流水號 ${sn} 有 ${this.total} 筆` : `找不到流水號 ${sn}`;
    }
    return true;
  },

  apiFilter() {
    const f = this.filters;
    const out = { collection_id: this.collection.id };
    if (f.q.trim()) out.q = f.q.trim();
    if (f.collectorId) out.collector_id = [Number(f.collectorId)];
    // taxon_id is OR on the server: send only the most specific one. The name
    // picker is scoped to the selected section, so the name implies it.
    if (f.taxon) out.taxon_id = [f.taxon.id];
    else if (f.sectionId) out.taxon_id = [Number(f.sectionId)];
    if (f.fieldFrom) out.field_number = f.fieldTo ? `${f.fieldFrom}--${f.fieldTo}` : f.fieldFrom;
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

  async search(page = 0) {
    if (!this.collection) return;
    this.loading = true;
    this.error = '';
    this.page = page;
    this.applied = JSON.parse(JSON.stringify(this.filters));
    const filter = this.apiFilter();
    const start = page * config.pageSize;
    try {
      const fields = [...this.types.map((t) => `annotation:${t.id}`), 'disposition'].join(',');
      const [list, facets] = await Promise.all([
        get('/api/v1/units', { filter, sort: this.sort, range: [start, start + config.pageSize] }),
        get('/api/v1/units/facets', { filter, fields }),
      ]);
      this.rows = list.data;
      this.total = list.total;
      this.facets = facets.facets;
      this.summary = facets.summary;
    } catch (e) {
      this.fail(e);
    } finally {
      this.loading = false;
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
  cell(col, row) {
    if (col.annotation) {
      const v = row.annotations[col.annotation] || '';
      const type = this.types.find((t) => t.name === col.annotation);
      const opt = type && type.options.find((o) => o[0] === v);
      return opt ? opt[1] : v;
    }
    return col.value(row) || '';
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
    if (f.q.trim()) add('q', '關鍵字', f.q.trim());
    if (f.catalogNumber.trim()) add('catalogNumber', '流水號', f.catalogNumber.trim());
    if (f.collectorId) {
      const c = this.collectors.find((x) => String(x.value) === String(f.collectorId));
      add('collectorId', '採集者', c ? c.label || c.value : f.collectorId);
    }
    if (f.taxon) add('taxon', '學名', f.taxon.label || escape(f.taxon.name), true);
    if (f.sectionId) add('sectionId', config.taxonomy.groupLabel, this.sectionName(f.sectionId));
    if (f.fieldFrom) add('field', '採集號', f.fieldTo ? `${f.fieldFrom}–${f.fieldTo}` : f.fieldFrom);
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

  exportHref(format) {
    return this.collection ? exportUrl(this.apiFilter(), format, this.sort) : '#';
  },
}));

window.Alpine = Alpine;
Alpine.start();
