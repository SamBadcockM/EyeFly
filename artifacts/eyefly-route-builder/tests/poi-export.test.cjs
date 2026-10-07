const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadRouteBuilder(fetch) {
  const html = fs.readFileSync(path.join(__dirname, "../public/route-builder.html"), "utf8");
  const core = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .find((script) => script.includes("const R_KM"));
  assert.ok(core, "route-builder engine script exists");

  const context = vm.createContext({
    module: { exports: {} },
    fetch,
    location: { protocol: "https:" },
    URLSearchParams,
    AbortSignal,
    setTimeout,
  });
  vm.runInContext(core, context);
  return context.module.exports;
}

function mockExcelJS() {
  let workbook;

  class Workbook {
    constructor() {
      workbook = this;
      this.worksheets = new Map();
      this.xlsx = { writeBuffer: async () => new Uint8Array([80, 75, 3, 4]) };
    }

    addWorksheet(name) {
      const rows = [];
      const sheet = {
        rows,
        addRow(values) {
          rows.push(values);
          return this;
        },
        getRow(rowNumber) {
          return {
            eachCell(callback) {
              (rows[rowNumber - 1] || []).forEach((value, index) => callback({ value, index }));
            },
          };
        },
        getColumn() {
          return {};
        },
        getCell() {
          return {};
        },
      };
      this.worksheets.set(name, sheet);
      return sheet;
    }
  }

  return { ExcelJS: { Workbook }, getWorkbook: () => workbook };
}

test("retries unlinked named POIs and writes the recovered POI to the Excel sheet", async () => {
  const queries = [];
  const fetch = async (url, options) => {
    assert.equal(url, "/api/overpass");
    const query = JSON.parse(options.body).query;
    queries.push(query);

    const elements = query.includes('["wikidata"]')
      ? []
      : [{
          type: "node",
          id: 9342,
          lat: 0,
          lon: 1,
          tags: { tourism: "attraction", name: "Fallback Attraction" },
        }];

    return { ok: true, status: 200, json: async () => ({ elements }) };
  };

  const routeBuilder = loadRouteBuilder(fetch);
  const { ExcelJS, getWorkbook } = mockExcelJS();
  const airports = [
    ["AAA", "AAAA", "Origin Airport", "Origin", "US", 0, 0],
    ["BBB", "BBBB", "Destination Airport", "Destination", "US", 0, 2],
  ];

  const result = await routeBuilder.buildRoute(airports, ExcelJS, {
    from: "AAA",
    to: "BBB",
    corridorKm: 50,
    maxPer5km: 3,
    enrich: false,
    categories: ["Landmark"],
  });

  const poiSheet = getWorkbook().worksheets.get("POIs");
  // Strict pass first (route is split in 150 km segments), then the empty stretches are retried without the
  // wikidata-tag requirement, then (still-blank stretches) with a wider corridor.
  const strict = queries.filter((q) => /\["wikidata"\]/.test(q));
  const relaxed = queries.filter((q) => !/\["wikidata"\]/.test(q));
  assert.ok(strict.length >= 1, "strict queries run first");
  assert.match(queries[0], /\["wikidata"\]/);
  assert.ok(relaxed.length >= 1, "broader retry runs for empty stretches");
  assert.equal(result.pois.length, 1);
  assert.equal(result.pois[0].name, "Fallback Attraction");
  assert.equal(poiSheet.rows.length, 2, "header plus one data row");
  assert.equal(poiSheet.rows[1][1], "Fallback Attraction");
});

test("uses Wikidata after Overpass fails and exports the source reference", async () => {
  const requests = [];
  const fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    if (url === "/api/overpass") {
      return { ok: false, status: 502, json: async () => ({ error: "busy" }) };
    }
    assert.equal(url, "/api/wikidata-pois");
    assert.ok(requests.at(-1).body.centers.length > 0);
    assert.equal(requests.at(-1).body.radiusKm, 50);
    assert.deepEqual(requests.at(-1).body.categories, ["Landmark"]);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        elements: [{
          type: "wikidata",
          id: 42,
          lat: 0,
          lon: 1,
          category: "Landmark",
          wikidata: "Q42",
          tags: {
            name: "Wikidata Landmark",
            "name:en": "Wikidata Landmark",
            wikidata: "Q42",
            description: "A place found through Wikidata.",
          },
        }],
      }),
    };
  };

  const routeBuilder = loadRouteBuilder(fetch);
  const { ExcelJS, getWorkbook } = mockExcelJS();
  const airports = [
    ["AAA", "AAAA", "Origin Airport", "Origin", "US", 0, 0],
    ["BBB", "BBBB", "Destination Airport", "Destination", "US", 0, 2],
  ];

  const result = await routeBuilder.buildRoute(airports, ExcelJS, {
    from: "AAA",
    to: "BBB",
    corridorKm: 50,
    maxPer5km: 3,
    enrich: false,
    categories: ["Landmark"],
  });

  const workbook = getWorkbook();
  const poiSheet = workbook.worksheets.get("POIs");
  const routeDetails = workbook.worksheets.get("Route Details");
  const routeSheet = workbook.worksheets.get("Route");
  assert.ok(requests.some((request) => request.url === "/api/wikidata-pois"));
  assert.equal(result.poi_source, "Wikidata");
  assert.equal(result.pois.length, 1);
  assert.equal(result.pois[0].name, "Wikidata Landmark");
  assert.equal(poiSheet.rows.length, 2, "header plus one data row");
  assert.equal(poiSheet.rows[1][1], "Wikidata Landmark");
  assert.equal(routeDetails.rows[0][7], "source_ref");
  assert.equal(routeDetails.rows[1][7], "Wikidata:Q42");
  assert.equal(routeSheet.rows[6][1], "Wikidata");
});


/* ---- coverage tests: simulate the Vercel deployment (no /api server) ---- */

// Fake world: a named, wikidata-tagged attraction every 0.3 degrees of longitude along the equator.
const WORLD = Array.from({ length: 60 }, (_, i) => ({ id: 1000 + i, lon: +(i * 0.3).toFixed(1), lat: 0 }))
  .map((p) => ({ ...p, name: `Place ${p.id}` }));

function overpassAnswer(query, { failBox, maxWidthDeg }) {
  const [s, w, n, e] = query.match(/\[bbox:([^\]]+)\]/)[1].split(",").map(Number);
  if (e - w > maxWidthDeg) return { status: 200, body: { elements: [], remark: "runtime error: Query timed out" } };
  if (failBox && failBox(w, e)) return { status: 400, body: {} };
  const elements = WORLD.filter((p) => p.lon >= w && p.lon <= e && p.lat >= s && p.lat <= n)
    .map((p) => ({ type: "node", id: p.id, lat: p.lat, lon: p.lon, tags: { tourism: "attraction", name: p.name, wikidata: `Q${p.id}` } }));
  return { status: 200, body: { elements } };
}

function wikidataAnswer(sparql) {
  const centers = [...sparql.matchAll(/Point\(([-\d.]+) ([-\d.]+)\)/g)].map((m) => ({ lon: +m[1], lat: +m[2] }));
  const bindings = WORLD.filter((p) => centers.some((c) => Math.abs(c.lon - p.lon) < 0.5)).map((p) => ({
    item: { value: `http://www.wikidata.org/entity/Q${p.id}` },
    itemLabel: { value: p.name },
    location: { value: `Point(${p.lon} ${p.lat})` },
    typeLabel: { value: "tourist attraction" },
  }));
  return { results: { bindings } };
}

function vercelFetch(opts, log) {
  return async (url, options) => {
    log.push(url);
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (url.startsWith("/api/")) return { ok: false, status: 404, json: async () => ({}) };
    if (url.includes("query.wikidata.org")) return ok(wikidataAnswer(decodeURIComponent(options.body.replace(/\+/g, " "))));
    const query = decodeURIComponent(options.body.replace(/^data=/, ""));
    const a = overpassAnswer(query, opts);
    return a.status === 200 ? ok(a.body) : { ok: false, status: a.status, json: async () => a.body };
  };
}

const ROUTE = [
  ["AAA", "AAAA", "Origin Airport", "Origin", "US", 0, 0],
  ["BBB", "BBBB", "Destination Airport", "Destination", "US", 0, 12],
];
const maxGap = (pois, total) => {
  const ks = [0, ...pois.map((p) => p.km_along), total];
  return Math.max(...ks.slice(1).map((k, i) => k - ks[i]));
};

test("static hosting: oversized boxes are split until the whole route is covered", async () => {
  const log = [];
  const rb = loadRouteBuilder(vercelFetch({ maxWidthDeg: 1.0 }, log));
  const { ExcelJS } = mockExcelJS();
  const r = await rb.buildRoute(ROUTE, ExcelJS, { from: "AAA", to: "BBB", corridorKm: 50, maxPer5km: 3, enrich: false, categories: ["Landmark"] });
  assert.equal(r.skipped_segments, 0);
  assert.equal(r.gaps.length, 0);
  assert.ok(maxGap(r.pois, r.distance_km) <= 100, "no stretch of the flight path longer than 100 km without a POI");
  assert.ok(r.pois.length >= 30);
});

test("static hosting: a stretch where Overpass keeps failing is filled from Wikidata directly", async () => {
  const log = [];
  const rb = loadRouteBuilder(vercelFetch({ maxWidthDeg: 3, failBox: (w, e) => e > 4 && w < 8 }, log));
  const { ExcelJS } = mockExcelJS();
  const r = await rb.buildRoute(ROUTE, ExcelJS, { from: "AAA", to: "BBB", corridorKm: 50, maxPer5km: 3, enrich: false, categories: ["Landmark"] });
  assert.ok(log.some((u) => u.includes("query.wikidata.org")), "browser queried Wikidata directly");
  assert.equal(r.poi_source, "OpenStreetMap + Wikidata");
  assert.equal(r.gaps.length, 0);
  assert.ok(maxGap(r.pois, r.distance_km) <= 100);
  assert.ok(r.pois.some((p) => p.lng > 4.5 && p.lng < 7.5), "POIs exist inside the failing stretch");
});

test("genuinely empty stretches are reported, not silently dropped", async () => {
  const log = [];
  const rb = loadRouteBuilder(vercelFetch({ maxWidthDeg: 3, failBox: null }, log));
  WORLD.filter((p) => p.lon > 5 && p.lon < 9).forEach((p) => { p.hidden = true; });
  const hidden = WORLD.filter((p) => p.hidden);
  hidden.forEach((p) => WORLD.splice(WORLD.indexOf(p), 1));
  try {
    const { ExcelJS } = mockExcelJS();
    const r = await rb.buildRoute(ROUTE, ExcelJS, { from: "AAA", to: "BBB", corridorKm: 50, maxPer5km: 3, enrich: false, categories: ["Landmark"] });
    assert.equal(r.gaps.length, 1);
    assert.ok(r.gaps[0][1] - r.gaps[0][0] > 400);
    assert.equal(r.gap_paths.length, 1);
  } finally {
    WORLD.push(...hidden);
  }
});

test("a heavy category that always times out cannot wipe out the cheap categories", async () => {
  const queries = [];
  const base = vercelFetch({ maxWidthDeg: 3 }, []);
  const fetch = async (url, options) => {
    if (!url.startsWith("/api/") && !url.includes("wikidata") && /^data=/.test(options.body)) {
      const q = decodeURIComponent(options.body.replace(/^data=/, "").replace(/\+/g, " "));
      queries.push(q);
      if (/"natural"="water"/.test(q)) {
        return { ok: true, status: 200, json: async () => ({ elements: [], remark: "runtime error: Query timed out" }) };
      }
    }
    return base(url, options);
  };
  const rb = loadRouteBuilder(fetch);
  const { ExcelJS } = mockExcelJS();
  const r = await rb.buildRoute(ROUTE, ExcelJS, { from: "AAA", to: "BBB", corridorKm: 50, maxPer5km: 3, enrich: false, categories: ["Landmark", "Lake"] });
  assert.equal(r.gaps.length, 0, "whole route still covered by the cheap categories");
  assert.ok(maxGap(r.pois, r.distance_km) <= 100);
  assert.ok(r.heavy_skipped > 0, "heavy category failure is reported");
  assert.ok(queries.filter((q) => /"tourism"="attraction"/.test(q)).every((q) => !/"natural"="water"/.test(q)),
    "heavy selectors are never mixed into the cheap queries");
});
