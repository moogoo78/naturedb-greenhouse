# naturedb-greenhouse

Query client for the greenhouse (living Begonia) collection, ported from basdb's greenhouse search.
It is a static Vite + Alpine.js app that talks **only** to naturedb's general API. naturedb has no
greenhouse-specific code: the room and propagation fields are unit annotation types of the
`greenhouse` collection. All greenhouse choices live in [`src/config.js`](src/config.js).

## Dev

Requires naturedb running (`docker compose up -d` in `~/d/naturedb`). This app joins its `naturedb_default` network.

```sh
cp .env.sample .env     # optional, defaults work
docker compose up -d --build
open http://localhost:8090
```

The Vite dev server proxies `/api`, `/admin` and `/static` to naturedb's flask, so the client is
same-origin: no CORS, and the login cookie is host-only. naturedb resolves its site from the
`Host` header (`NATUREDB_SITE_HOST`, default `hast.localhost:5000`).

Not logged in → redirected to naturedb's `/admin/login?next=...`, then back.

## Features

- sources: 溫室活體 (collection `greenhouse`), HAST 標本 (collection `hast`, limited to Begoniaceae) or both; see `config.sources`. QR, status, room and propagation apply to the living collection only, so setting one narrows "both" to it
- search: keyword, 流水號 (QR serial = `unit.catalog_number`), collector, section (dropdown of `config.taxonomy.groupRank` taxa under the genus), scientific name (autocomplete limited to the family, or to the chosen section), field-number range; taxa include descendants
- facets with counts: 狀態 (alive/dead from `unit.disposition`), 房間, 類別; click to filter
- summary: units, taxa, unidentified
- export current filter: Excel (xlsx) / CSV
- QR lookup: `/#/tag/<sn>` jumps to the record form when the serial is unique

## naturedb API used

All require the JWT cookie from naturedb's `/admin/login`. Unit endpoints share a `filter` JSON;
see `app/helpers_unit_query.py` in naturedb for the full format. Each source is one sub-filter of `any`
(OR), e.g. `{"collection_id":[9,1],"any":[{"collection_id":9},{"collection_id":1,"taxon_id":[<Begoniaceae>]}]}`,
with the common filters at the top level.

| endpoint | use |
|---|---|
| `GET /api/v1/me` | user + site collections (collection id resolved by `config.collectionName`) |
| `GET /api/v1/collections/<id>/annotation-types?target=unit` | custom fields + select options |
| `GET /api/v1/units?filter=&sort=&range=[0,50]` | result rows |
| `GET /api/v1/units/facets?filter=&fields=disposition,collector,annotation:<id>` | counts + summary |
| `GET /api/v1/units/export?filter=&format=csv\|xlsx` | download |
| `GET /api/v1/taxa?filter={"q","rank","parent_id","collection_id"}` | section list + name picker, scoped to the collection's taxon tree |
| `/admin/records/u<unit_id>` | record form (link target) |

## Production

Serve the build from its own subdomain on the same parent domain as naturedb (e.g. `greenhouse.biodiv.tw` next to `hast.biodiv.tw`):

```sh
VITE_NATUREDB_BASE=https://hast.biodiv.tw GREENHOUSE_HOST=greenhouse.biodiv.tw \
  docker compose -f compose.prod.yml up -d --build
```

The container joins naturedb's network (`NATUREDB_NETWORK`, default `naturedb_default`) and naturedb's
Traefik routes `GREENHOUSE_HOST` to it and issues its certificate; the hostname needs a Cloudflare DNS
record first. Set these naturedb env vars, then run `docker compose up -d` (a restart does not reload env):

```
CORS_ALLOWED_ORIGINS=https://greenhouse.biodiv.tw
JWT_COOKIE_DOMAIN=.biodiv.tw
```

`JWT_COOKIE_DOMAIN` lets the login cookie reach the client's subdomain. naturedb only redirects
after login to origins listed in `CORS_ALLOWED_ORIGINS`.

Data prerequisite (once per DB): run `scripts/sql/greenhouse-unit-annotations.sql` in naturedb.
