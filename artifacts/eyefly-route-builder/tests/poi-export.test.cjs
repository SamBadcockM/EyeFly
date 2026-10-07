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
  assert.equal(queries.length, 2, "one strict query and one broader retry run");
  assert.match(queries[0], /\["wikidata"\]/);
  assert.doesNotMatch(queries[1], /\["wikidata"\]/);
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
