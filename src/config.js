// Everything greenhouse-specific lives here. naturedb itself knows nothing about
// this client: the collection, its custom fields (annotation types) and their
// options all come from the general API at runtime.

import { scientificNameHtml } from './names.js';

const DEAD = 'Dead (Disposed of; not retained.)';

export default {
  title: '溫室活體查詢',
  subtitle: 'Begonia living collection',

  // collection.name in naturedb (resolved to an id via /api/v1/me) of the living
  // collection: its taxon tree, annotations, alive/dead and QR serials
  collectionName: 'greenhouse',

  // collections to search; `living` ones take the greenhouse-only filters (QR,
  // status, annotations), `familyOnly` ones are limited to taxonomy.family.
  // The source switch offers each one plus all together; the summary counts
  // each source's units under its `unit` label.
  sources: [
    { key: 'greenhouse', label: '溫室活體', collectionName: 'greenhouse', living: true,
      unit: { label: '株', sub: 'living specimen' } },
    { key: 'hast', label: 'HAST 標本', collectionName: 'hast', familyOnly: true,
      unit: { label: '件', sub: 'preserved specimen' } },
  ],
  defaultSource: 'greenhouse',

  // unit annotation types (by name) shown as filters + facets, in this order;
  // [] = every unit annotation type of the collection
  annotationFacets: ['room', 'propagation'],

  // taxon filters, resolved by name inside the collection's taxon tree:
  // a dropdown of `groupRank` taxa under `genus`, and a scientific-name
  // autocomplete limited to descendants of `family`
  taxonomy: { family: 'Begoniaceae', genus: 'Begonia', groupRank: 'section', groupLabel: 'Section' },

  // alive/dead filter -> unit.disposition
  status: {
    alive: { label: '存活', disposition: { not: [DEAD] } },
    dead: { label: '死亡', disposition: DEAD },
  },

  // specimen images: the API returns the stored cover image URL; this storage
  // keeps size variants next to it (-s 9KB, -m, -l, -x, -o original)
  image: {
    size: (url, s) => (/-m\.jpg$/.test(url) ? url.replace(/-m\.jpg$/, `-${s}.jpg`) : url),
    thumb: 's',
    preview: 'l',
    full: 'o',
  },

  // record view: one row per record (collector + number) with its units as
  // chips; a living unit's chip shows this annotation (e.g. its room)
  unitChip: { annotation: 'room' },

  pageSize: 50,
  defaultSort: 'catalog_number',

  // table columns: label + value(row) (+ optional sort key understood by the API,
  // html(row) for markup built from escaped text, filter: 'collector' | 'taxon'
  // to make the cell a click-to-filter button, mixedLabel when non-living sources
  // are included, source: true for the source label (or value(row) if set), only in "all", image: true
  // for the cover image thumbnail, only with non-living sources; view: 'unit' |
  // 'record' to show in one list view only; link: 'unit' | 'record' links the
  // cell to the admin form in that view; units: true lists the record's units)
  columns: [
    // a herbarium's catalog number is its specimen number (館號)
    {
      label: '流水號',
      mixedLabel: '流水號 / 館號',
      sort: 'catalog_number',
      value: (r) => r.catalog_number,
      link: 'unit',
      view: 'unit',
    },
    // shown when several sources are searched; value(row) replaces the source label
    { label: '來源', source: true, value: (r) => r.basis_of_record, view: 'unit' },
    { label: '影像', image: true, view: 'unit' }, // shown when a source with images is searched
    {
      label: '採集者',
      value: (r) => (r.collector ? r.collector.full_name || r.collector.full_name_en : r.verbatim_collector),
      filter: 'collector', // click: filter by this collector
    },
    { label: '採集號', sort: 'field_number', value: (r) => r.field_number, link: 'record' },
    { label: '採集日期', sort: 'collect_date', value: (r) => r.collect_date },
    { label: '地點', value: (r) => r.locality_text, className: 'locality' },
    {
      label: '物種',
      sort: 'taxon',
      value: (r) => (r.taxon ? r.taxon.scientific_name : ''),
      html: (r) => (r.taxon ? scientificNameHtml(r.taxon.scientific_name) : ''),
      sub: (r) => (r.taxon ? r.taxon.common_name : ''),
      className: 'taxon',
      filter: 'taxon', // click: filter by this taxon
    },
    { label: '備註', value: (r) => r.notes, className: 'notes', view: 'unit' },
    { label: '植株 / 標本', units: true, className: 'units', view: 'record' },
  ],
};
