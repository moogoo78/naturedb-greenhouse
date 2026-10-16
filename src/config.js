// Everything greenhouse-specific lives here. naturedb itself knows nothing about
// this client: the collection, its custom fields (annotation types) and their
// options all come from the general API at runtime.

const DEAD = 'Dead (Disposed of; not retained.)';

export default {
  title: '溫室活體查詢',
  subtitle: 'Begonia living collection',

  // collection.name in naturedb (resolved to an id via /api/v1/me)
  collectionName: 'greenhouse',

  // unit annotation types (by name) shown as filters + facets, in this order;
  // [] = every unit annotation type of the collection
  annotationFacets: ['room', 'propagation'],

  // alive/dead filter -> unit.disposition
  status: {
    alive: { label: '存活', disposition: { not: [DEAD] } },
    dead: { label: '死亡', disposition: DEAD },
  },

  pageSize: 50,
  defaultSort: 'catalog_number',

  // table columns: label + value(row) (+ optional sort key understood by the API)
  columns: [
    { label: '流水號', sort: 'catalog_number', value: (r) => r.catalog_number },
    { label: '採集號', sort: 'field_number', value: (r) => r.field_number },
    {
      label: '採集者',
      value: (r) => (r.collector ? r.collector.full_name || r.collector.full_name_en : r.verbatim_collector),
    },
    {
      label: '學名',
      sort: 'taxon',
      value: (r) => (r.taxon ? r.taxon.scientific_name : ''),
      sub: (r) => (r.taxon ? r.taxon.common_name : ''),
      className: 'taxon',
    },
    { label: '房間', annotation: 'room' },
    { label: '類別', annotation: 'propagation' },
    { label: '狀態', value: (r) => (r.disposition === DEAD ? '死亡' : '存活') },
    { label: '備註', value: (r) => r.notes, className: 'notes' },
  ],
};
