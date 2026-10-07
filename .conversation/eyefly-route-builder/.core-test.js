
/* Eyefly route + POI engine (runs in the browser and in Node for tests). */
const R_KM = 6371.0088;
const POI_COLUMNS = ["id", "name", "subtitle", "category", "description", "lat", "lng",
  "trigger_radius_km", "emoji", "gradient_color_1", "gradient_color_2", "accent_color",
  "chips", "image_url"];
const CHIP_SEP = "|";

/* w = base importance weight used when ranking POIs for display density. */
const CATEGORIES = {
  // ---- Landforms
  "Mountain": { group: "Landforms", w: 4, sel: ['node["natural"="peak"]["name"]["wikidata"]'], trig: 15, colors: ["#1f2a44", "#5b7aa6", "#a9c4eb"] },
  "Mountain Range": { group: "Landforms", w: 5, area: true, sel: ['node["natural"="mountain_range"]["name"]["wikidata"]', 'way["natural"="mountain_range"]["name"]["wikidata"]', 'relation["natural"="mountain_range"]["name"]["wikidata"]'], trig: 40, colors: ["#2b2f3a", "#7d8aa3", "#c6d0e4"] },
  "Volcano": { group: "Landforms", w: 6, sel: ['node["natural"="volcano"]["name"]'], trig: 20, colors: ["#3b1410", "#b23a1e", "#ff8a4c"] },
  "Crater": { group: "Landforms", w: 6, sel: ['node["geological"="meteor_crater"]["name"]', 'way["geological"="meteor_crater"]["name"]'], trig: 8, colors: ["#2e1f14", "#8a5a3a", "#e6b98f"] },
  "Glacier": { group: "Landforms", w: 5, area: true, sel: ['way["natural"="glacier"]["name"]["wikidata"]', 'relation["natural"="glacier"]["name"]["wikidata"]'], trig: 10, colors: ["#14303f", "#7fb7d6", "#e4f6ff"] },
  "Desert": { group: "Landforms", w: 5, area: true, sel: ['way["natural"="desert"]["name"]["wikidata"]', 'relation["natural"="desert"]["name"]["wikidata"]', 'node["natural"="desert"]["name"]["wikidata"]'], trig: 40, colors: ["#4a3416", "#c98f3f", "#f6d795"] },
  "Canyon & Valley": { group: "Landforms", w: 5, area: true, sel: ['node["natural"~"^(valley|gorge|canyon)$"]["name"]["wikidata"]', 'way["natural"~"^(valley|gorge|canyon)$"]["name"]["wikidata"]', 'relation["natural"~"^(valley|gorge|canyon)$"]["name"]["wikidata"]'], trig: 15, colors: ["#4a2412", "#b5602f", "#f0b48a"] },
  "Cliff & Ridge": { group: "Landforms", w: 3, sel: ['way["natural"~"^(cliff|ridge|arete)$"]["name"]["wikidata"]', 'relation["natural"~"^(cliff|ridge)$"]["name"]["wikidata"]'], trig: 8, colors: ["#2a2620", "#8c7a62", "#dccbb0"] },
  "Hot Spring & Geyser": { group: "Landforms", w: 4, sel: ['node["natural"~"^(hot_spring|geyser)$"]["name"]["wikidata"]'], trig: 3, colors: ["#3a1d33", "#b0467f", "#ffb3d9"] },
  "Cave": { group: "Landforms", w: 2, sel: ['node["natural"="cave_entrance"]["name"]["wikidata"]'], trig: 3, colors: ["#221c18", "#6b5a4a", "#c9b8a6"] },
  "Island": { group: "Landforms", w: 4, area: true, sel: ['node["place"~"^(island|archipelago)$"]["name"]["wikidata"]', 'way["place"="island"]["name"]["wikidata"]', 'relation["place"~"^(island|archipelago)$"]["name"]["wikidata"]'], trig: 15, colors: ["#0b3b36", "#2aa07f", "#9af0cf"] },
  "National Park": { group: "Landforms", w: 6, area: true, sel: ['relation["boundary"="national_park"]["name"]["wikidata"]', 'relation["boundary"="protected_area"]["protect_class"~"^(1a|1b|2)$"]["name"]["wikidata"]'], trig: 20, colors: ["#16301c", "#3f7d3a", "#a6e08f"] },
  "Forest": { group: "Landforms", w: 3, area: true, sel: ['relation["landuse"="forest"]["name"]["wikidata"]', 'relation["natural"="wood"]["name"]["wikidata"]', 'way["natural"="wood"]["name"]["wikidata"]'], trig: 20, colors: ["#10261a", "#2f6b45", "#8fd6a6"] },
  // ---- Water
  "River": { group: "Water", w: 3, sel: ['way["waterway"="river"]["name"]["wikidata"]'], geom: true, trig: 5, colors: ["#0c2a4a", "#1c6bb0", "#6ec1ff"] },
  "Lake": { group: "Water", w: 4, area: true, sel: ['way["natural"="water"]["water"~"^(lake|reservoir|lagoon)$"]["name"]["wikidata"]', 'relation["natural"="water"]["water"~"^(lake|reservoir|lagoon)$"]["name"]["wikidata"]'], trig: 8, colors: ["#0a2f3a", "#1b8a9e", "#7fe0ee"] },
  "Waterfall": { group: "Water", w: 4, sel: ['node["waterway"="waterfall"]["name"]["wikidata"]'], trig: 3, colors: ["#0e2b3d", "#3a8fb7", "#b6ecff"] },
  "Sea & Coast": { group: "Water", w: 4, area: true, sel: ['node["place"~"^(sea|ocean)$"]["name"]', 'node["natural"~"^(bay|strait|cape|peninsula|reef)$"]["name"]["wikidata"]', 'way["natural"~"^(peninsula|reef)$"]["name"]["wikidata"]', 'relation["natural"~"^(peninsula|reef|bay|strait)$"]["name"]["wikidata"]'], trig: 30, colors: ["#08213f", "#245f9e", "#8cc2f5"] },
  "Wetland & Delta": { group: "Water", w: 3, area: true, sel: ['way["natural"="wetland"]["name"]["wikidata"]', 'relation["natural"="wetland"]["name"]["wikidata"]'], trig: 15, colors: ["#17301f", "#4f8f5a", "#b8e6a8"] },
  "Beach": { group: "Water", w: 2, off: true, sel: ['way["natural"="beach"]["name"]["wikidata"]'], trig: 3, colors: ["#3a3116", "#d1b26a", "#fff0c2"] },
  // ---- Places
  "City": { group: "Places", w: 6, sel: ['node["place"="city"]["name"]'], trig: 12, colors: ["#2a2433", "#6d5a8a", "#d3bff0"] },
  "Town": { group: "Places", w: 3, off: true, sel: ['node["place"="town"]["name"]["wikidata"]'], trig: 8, colors: ["#2a2a33", "#7a7a99", "#d6d6ee"] },
  "World Heritage Site": { group: "Places", w: 7, sel: ['nwr["heritage"="1"]["name"]["wikidata"]'], trig: 5, colors: ["#3a2a0a", "#c9962a", "#ffe08a"] },
  "Landmark": { group: "Places", w: 3, sel: ['node["tourism"="attraction"]["name"]["wikidata"]', 'way["tourism"="attraction"]["name"]["wikidata"]', 'nwr["historic"~"^(castle|fort)$"]["name"]["wikidata"]', 'node["historic"="monument"]["name"]["wikidata"]', 'nwr["man_made"~"^(lighthouse|tower)$"]["name"]["wikidata"]'], trig: 3, colors: ["#3a2a12", "#a9792f", "#f1d08a"] },
  "Archaeological Site": { group: "Places", w: 4, sel: ['node["historic"~"^(archaeological_site|ruins)$"]["name"]["wikidata"]', 'way["historic"~"^(archaeological_site|ruins)$"]["name"]["wikidata"]', 'relation["historic"~"^(archaeological_site|ruins)$"]["name"]["wikidata"]'], trig: 3, colors: ["#3d2c1a", "#9a7a4a", "#e3c995"] },
  "Religious Site": { group: "Places", w: 3, off: true, sel: ['way["building"~"^(cathedral|mosque|temple)$"]["name"]["wikidata"]', 'node["building"~"^(cathedral|mosque|temple)$"]["name"]["wikidata"]'], trig: 3, colors: ["#2d2338", "#8e6bb3", "#e0c9ff"] },
  // ---- Human-made
  "Airport": { group: "Human-made", w: 3, sel: ['node["aeroway"="aerodrome"]["name"]["iata"]', 'way["aeroway"="aerodrome"]["name"]["iata"]', 'relation["aeroway"="aerodrome"]["name"]["iata"]'], trig: 8, colors: ["#1b2a33", "#4f7d96", "#b9dcee"] },
  "Port & Harbour": { group: "Human-made", w: 3, sel: ['way["landuse"="port"]["name"]["wikidata"]', 'relation["landuse"="port"]["name"]["wikidata"]', 'way["industrial"="port"]["name"]["wikidata"]'], trig: 5, colors: ["#132636", "#3f7fa8", "#a9daf5"] },
  "Dam": { group: "Human-made", w: 4, sel: ['way["waterway"="dam"]["name"]["wikidata"]', 'way["man_made"="dam"]["name"]["wikidata"]'], trig: 4, colors: ["#16283a", "#43698f", "#a3c8ea"] },
  "Bridge": { group: "Human-made", w: 3, sel: ['way["man_made"="bridge"]["name"]["wikidata"]'], trig: 3, colors: ["#2a2220", "#8a6f66", "#e0c3b9"] },
  "Observatory": { group: "Human-made", w: 3, sel: ['node["man_made"="observatory"]["name"]["wikidata"]', 'way["man_made"="observatory"]["name"]["wikidata"]'], trig: 3, colors: ["#151a33", "#4b56a8", "#bcc4ff"] },
  "Stadium & Track": { group: "Human-made", w: 2, sel: ['node["leisure"="stadium"]["name"]["wikidata"]', 'way["leisure"="stadium"]["name"]["wikidata"]', 'relation["leisure"="stadium"]["name"]["wikidata"]', 'way["highway"="raceway"]["name"]["wikidata"]'], trig: 3, colors: ["#12301a", "#2f9a4a", "#9df0b0"] },
  "Theme Park": { group: "Human-made", w: 2, sel: ['node["tourism"="theme_park"]["name"]["wikidata"]', 'way["tourism"="theme_park"]["name"]["wikidata"]', 'relation["tourism"="theme_park"]["name"]["wikidata"]'], trig: 3, colors: ["#3a1230", "#c43fa0", "#ffadea"] },
  "Power Station": { group: "Human-made", w: 2, sel: ['node["power"="plant"]["name"]["wikidata"]', 'way["power"="plant"]["name"]["wikidata"]', 'relation["power"="plant"]["name"]["wikidata"]'], trig: 5, colors: ["#33301a", "#b5a62f", "#f5eb8a"] },
  "Mine & Quarry": { group: "Human-made", w: 3, area: true, sel: ['way["landuse"="quarry"]["name"]["wikidata"]', 'relation["landuse"="quarry"]["name"]["wikidata"]'], trig: 5, colors: ["#2e2a26", "#85786b", "#d4c8ba"] },
  "Ski Resort": { group: "Human-made", w: 2, off: true, area: true, sel: ['way["landuse"="winter_sports"]["name"]["wikidata"]', 'relation["landuse"="winter_sports"]["name"]["wikidata"]'], trig: 5, colors: ["#1d2a3a", "#7aa2cc", "#eaf4ff"] },
};
const DEFAULT_CATEGORIES = Object.keys(CATEGORIES).filter(c => !CATEGORIES[c].off);

/* Priority-ordered: the first matching rule whose category is enabled wins, so e.g. a castle
   with heritage=1 shows as World Heritage Site, but still shows as Landmark if that type is off. */
const CLASSIFY_RULES = [
  ["World Heritage Site", t => t.heritage === "1"],
  ["Mountain", t => t.natural === "peak"],
  ["Mountain Range", t => t.natural === "mountain_range"],
  ["Volcano", t => t.natural === "volcano"],
  ["Crater", t => t.geological === "meteor_crater"],
  ["River", t => t.waterway === "river"],
  ["Waterfall", t => t.waterway === "waterfall"],
  ["Dam", t => t.waterway === "dam" || t.man_made === "dam"],
  ["Lake", t => t.natural === "water"],
  ["Glacier", t => t.natural === "glacier"],
  ["Desert", t => t.natural === "desert"],
  ["Canyon & Valley", t => ["valley", "gorge", "canyon"].includes(t.natural)],
  ["Cliff & Ridge", t => ["cliff", "ridge", "arete"].includes(t.natural)],
  ["Hot Spring & Geyser", t => ["hot_spring", "geyser"].includes(t.natural)],
  ["Cave", t => t.natural === "cave_entrance"],
  ["Wetland & Delta", t => t.natural === "wetland"],
  ["Beach", t => t.natural === "beach"],
  ["Airport", t => t.aeroway === "aerodrome"],
  ["City", t => t.place === "city"],
  ["Town", t => t.place === "town"],
  ["Island", t => t.place === "island" || t.place === "archipelago"],
  ["National Park", t => t.boundary === "national_park" || (t.boundary === "protected_area" && /^(1a|1b|2)$/.test(t.protect_class || ""))],
  ["Forest", t => t.landuse === "forest" || t.natural === "wood"],
  ["Sea & Coast", t => t.place === "sea" || t.place === "ocean" || ["bay", "strait", "cape", "peninsula", "reef"].includes(t.natural)],
  ["Port & Harbour", t => t.landuse === "port" || t.industrial === "port"],
  ["Observatory", t => t.man_made === "observatory"],
  ["Stadium & Track", t => t.leisure === "stadium" || t.highway === "raceway"],
  ["Theme Park", t => t.tourism === "theme_park"],
  ["Power Station", t => t.power === "plant"],
  ["Mine & Quarry", t => t.landuse === "quarry"],
  ["Ski Resort", t => t.landuse === "winter_sports"],
  ["Bridge", t => t.man_made === "bridge"],
  ["Archaeological Site", t => t.historic === "archaeological_site" || t.historic === "ruins"],
  ["Religious Site", t => ["cathedral", "mosque", "temple"].includes(t.building)],
  ["Landmark", t => t.tourism === "attraction" || ["castle", "fort", "monument"].includes(t.historic) || ["lighthouse", "tower"].includes(t.man_made)],
];

function classify(t, allowed) {
  for (const [cat, test] of CLASSIFY_RULES) if ((!allowed || allowed.includes(cat)) && test(t)) return cat;
  return null;
}

/* ---------- airports (AIRPORTS = [[iata, icao, name, city, country, lat, lon], ...]) ---------- */
function airportObj(r) {
  return { iata: r[0], icao: r[1], name: r[2], city: r[3], country: r[4], lat: r[5], lon: r[6] };
}
function airportLabel(a) { return `${a.name} (${a.iata})`; }

function searchAirports(AIRPORTS, q, limit = 8) {
  q = (q || "").trim().toLowerCase();
  if (q.length < 2) return [];
  const scored = [];
  for (const r of AIRPORTS) {
    const name = r[2].toLowerCase(), city = r[3].toLowerCase();
    let s;
    if (r[0].toLowerCase() === q) s = 100;
    else if (r[1].toLowerCase() === q) s = 95;
    else if (name.startsWith(q) || city.startsWith(q)) s = 60;
    else if (name.includes(q) || city.includes(q)) s = 40;
    else continue;
    scored.push([-s, r[2].length, r]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return scored.slice(0, limit).map(x => airportObj(x[2]));
}

function resolveAirport(AIRPORTS, text) {
  text = (text || "").trim();
  if (!text) throw new Error("Please enter an airport.");
  const m = text.match(/\(([A-Za-z]{3,4})\)\s*$/);
  const code = (m ? m[1] : text).toUpperCase();
  if (code.length === 3 || code.length === 4) {
    const hit = AIRPORTS.find(r => (code.length === 3 ? r[0] : r[1]) === code);
    if (hit) return airportObj(hit);
  }
  const hits = searchAirports(AIRPORTS, text, 1);
  if (!hits.length) throw new Error(`Couldn't find an airport matching '${text}'.`);
  return hits[0];
}

/* ---------- geometry ---------- */
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;

function haversine(lat1, lon1, lat2, lon2) {
  const p1 = rad(lat1), p2 = rad(lat2), dp = p2 - p1, dl = rad(lon2) - rad(lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}

function bearing(lat1, lon1, lat2, lon2) {
  const p1 = rad(lat1), p2 = rad(lat2), dl = rad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

function greatCircle(lat1, lon1, lat2, lon2, stepKm = 10) {
  const d = haversine(lat1, lon1, lat2, lon2);
  if (d < 1) throw new Error("The two airports are the same (or practically the same) place.");
  const delta = d / R_KM;
  if (Math.sin(delta) < 1e-9) throw new Error("Those airports are antipodal; the great-circle path isn't unique.");
  const n = Math.max(2, Math.ceil(d / stepKm) + 1);
  const p1 = rad(lat1), l1 = rad(lon1), p2 = rad(lat2), l2 = rad(lon2);
  const path = [], cum = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const A = Math.sin((1 - f) * delta) / Math.sin(delta), B = Math.sin(f * delta) / Math.sin(delta);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    path.push([deg(Math.atan2(z, Math.sqrt(x * x + y * y))), deg(Math.atan2(y, x))]);
    cum.push(f * d);
  }
  return { path, cum, total: d };
}

function unwrapLons(lons) {
  const out = [lons[0]];
  for (let i = 1; i < lons.length; i++) {
    let v = lons[i];
    while (v - out[i - 1] > 180) v -= 360;
    while (v - out[i - 1] < -180) v += 360;
    out.push(v);
  }
  return out;
}

function locate(lat, lon, path, cum, lo = 0, hi = path.length - 1) {
  let i = Math.max(0, lo), best = Infinity;
  for (let k = Math.max(0, lo); k <= Math.min(path.length - 1, hi); k++) {
    const d = haversine(lat, lon, path[k][0], path[k][1]);
    if (d < best) { best = d; i = k; }
  }
  const [j, k] = i < path.length - 1 ? [i, i + 1] : [i - 1, i];
  const track = bearing(path[j][0], path[j][1], path[k][0], path[k][1]);
  const toPoi = bearing(path[i][0], path[i][1], lat, lon);
  const diff = ((toPoi - track + 540) % 360) - 180;
  return { kmAlong: cum[i], offset: best, side: diff > 0 ? "right" : "left" };
}

/* ---------- Overpass ---------- */
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const CHUNK_KM = 300;
const CONCURRENCY = 2; // overpass-api.de allows ~2 parallel slots per IP; more just gets 429s
const QUERY_TIMEOUT_S = 60;
const PROXY_TIMEOUT_MS = 125000; // the proxy may fall back to a mirror after the primary
const DIRECT_TIMEOUT_MS = (QUERY_TIMEOUT_S + 10) * 1000;
const MAX_SPLITS = 2; // a failed segment is retried as 2, then 4 smaller boxes before being skipped

const queryCache = new Map();
let proxyAvailable = typeof location !== "undefined" && location.protocol.startsWith("http");

/* Overpass reports query timeouts / out-of-memory as HTTP 200 with a "remark". */
function checkOverpassData(data) {
  if (data && typeof data.remark === "string" && /runtime error/i.test(data.remark)) throw new Error("query too large");
  return data;
}

/* Cached server proxy (handles retries + mirrors server-side). Overpass directly only for static hosting. */
async function overpass(query) {
  if (queryCache.has(query)) return queryCache.get(query);
  let data;
  if (proxyAvailable) {
    let r;
    try {
      r = await fetch("/api/overpass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
      });
    } catch (e) {
      throw new Error(e.name === "TimeoutError" ? "request timed out" : "network error");
    }
    if (r.status === 404) { proxyAvailable = false; return overpass(query); }
    if (!r.ok) throw new Error(`server busy (HTTP ${r.status})`);
    data = checkOverpassData(await r.json());
  } else {
    data = await overpassDirect(query);
  }
  queryCache.set(query, data);
  return data;
}

async function overpassDirect(query, attempt = 0) {
  const url = ENDPOINTS[attempt % ENDPOINTS.length];
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(query),
      signal: AbortSignal.timeout(DIRECT_TIMEOUT_MS),
    });
    if (response.ok) return checkOverpassData(await response.json());
    if (attempt < 2 && [429, 502, 503, 504].includes(response.status)) {
      await sleep(1500 * (attempt + 1));
      return overpassDirect(query, attempt + 1);
    }
    throw new Error(`HTTP ${response.status}`);
  } catch (e) {
    if (attempt < 2 && (e instanceof TypeError || e.name === "TimeoutError" || e.name === "AbortError")) {
      await sleep(1000 * (attempt + 1));
      return overpassDirect(query, attempt + 1);
    }
    throw e;
  }
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/* Split the route into short pieces, each with its own small bbox hugging the corridor
   instead of one giant rectangle covering the whole route. */
function corridorChunks(path, cum, bufferKm) {
  const chunks = [];
  let start = 0;
  while (start < path.length - 1) {
    let end = start;
    while (end < path.length - 1 && cum[end] - cum[start] < CHUNK_KM) end++;
    const lats = [], lons = unwrapLons(path.slice(start, end + 1).map(p => p[1]));
    for (let i = start; i <= end; i++) lats.push(path[i][0]);
    const midLat = lats.reduce((s, v) => s + v, 0) / lats.length;
    const dLat = bufferKm / 111;
    const dLon = bufferKm / (111 * Math.max(0.05, Math.cos(rad(Math.min(85, Math.abs(midLat) + dLat)))));
    const s = Math.max(-90, Math.min(...lats) - dLat), n = Math.min(90, Math.max(...lats) + dLat);
    const w = Math.min(...lons) - dLon, e = Math.max(...lons) + dLon;
    const norm = v => ((v + 540) % 360) - 180;
    const bboxes = [];
    if (e - w >= 360) bboxes.push([s, -180, n, 180]);
    else {
      const nw = norm(w), ne = norm(e);
      if (nw <= ne) bboxes.push([s, nw, n, ne]);
      else { bboxes.push([s, nw, n, 180]); bboxes.push([s, -180, n, ne]); }
    }
    const margin = Math.ceil(bufferKm / Math.max(1, cum[1] - cum[0]));
    for (const b of bboxes) chunks.push({ bbox: b, lo: start - margin, hi: end + margin });
    start = end;
  }
  return chunks;
}

function buildQuery(bbox, cats, includeUnlinked = false) {
  const sels = [...new Set(cats.flatMap(c => CATEGORIES[c].sel.map(selector =>
    includeUnlinked ? selector.replace(/\["wikidata"\]/g, "") : selector
  )))];
  const b = bbox.map(v => v.toFixed(4)).join(",");
  return `[out:json][timeout:${QUERY_TIMEOUT_S}][bbox:${b}];\n(\n${sels.map(s => "  " + s + ";").join("\n")}\n)->.r;\nnode.r;\nout qt;\n(way.r; relation.r;);\nout tags center qt;`;
}

/* Halve a bbox along its longer real-world side. */
function splitBbox([s, w, n, e]) {
  const widthKm = (e - w) * 111 * Math.cos(rad((s + n) / 2)), heightKm = (n - s) * 111;
  if (widthKm >= heightKm) { const m = (w + e) / 2; return [[s, w, n, m], [s, m, n, e]]; }
  const m = (s + n) / 2;
  return [[s, w, m, e], [m, w, n, e]];
}

/* Fetch one box; if it fails (timeout / busy), retry it as smaller boxes instead of failing the whole route. */
async function fetchBox(bbox, cats, depth = 0, includeUnlinked = false) {
  try {
    const data = await overpass(buildQuery(bbox, cats, includeUnlinked));
    return { elements: data.elements || [], failed: 0, error: "" };
  } catch (e) {
    if (depth >= MAX_SPLITS) return { elements: [], failed: 1, error: e.message };
    const out = { elements: [], failed: 0, error: "" };
    for (const part of splitBbox(bbox)) {
      const r = await fetchBox(part, cats, depth + 1, includeUnlinked);
      out.elements.push(...r.elements);
      out.failed += r.failed;
      out.error = r.error || out.error;
    }
    return out;
  }
}

/* ---------- importance ranking + map density ---------- */
const DENSITY_WINDOW_KM = 5;
const MIN_SPACING_KM = 1.5;

function importance(p, corridorKm) {
  const t = p.tags, cat = CATEGORIES[p.category];
  let s = cat.w ?? 3;
  if (t.wikipedia) s += 3;
  if (t.wikidata) s += 1;
  // Number of translated names is a good proxy for how internationally known a place is.
  const names = Object.keys(t).filter(k => k.startsWith("name:")).length;
  s += Math.min(4, Math.log2(1 + names));
  if (t.heritage === "1" || t["whc:inscription_date"]) s += 4;
  if (p.category === "Mountain" || p.category === "Volcano") s += Math.min(4, (eleNum(t) || 0) / 1500);
  if (p.category === "City" || p.category === "Town") {
    const pop = parseInt(String(t.population || "").replace(/[^\d]/g, ""), 10);
    if (pop > 0) s += Math.min(4, Math.max(0, Math.log10(pop) - 4));
    if (t.capital === "yes" || t.capital === "2") s += 3;
  }
  if (p.category === "Airport" && t["aerodrome:type"] === "international") s += 2;
  const limit = corridorKm * (cat.area ? 2 : 1);
  s -= 2 * Math.min(1, p.offset_km / limit);
  return +s.toFixed(2);
}

/* Greedy pick by importance: at most `maxPerWindow` POIs per 5 km of route, one per category
   per window (for variety), and never two markers on top of each other. */
function thinByDensity(pois, maxPerWindow) {
  const sorted = [...pois].sort((a, b) => b.importance - a.importance);
  const windows = new Map();
  const kept = [];
  for (const p of sorted) {
    const k = Math.floor(p.km_along / DENSITY_WINDOW_KM);
    const here = windows.get(k) || [];
    if (here.length >= maxPerWindow) continue;
    if (here.some(q => q.category === p.category)) continue;
    let crowded = false;
    for (let j = k - 1; j <= k + 1 && !crowded; j++) {
      crowded = (windows.get(j) || []).some(q => haversine(p.lat, p.lng, q.lat, q.lng) < MIN_SPACING_KM);
    }
    if (crowded) continue;
    here.push(p);
    windows.set(k, here);
    kept.push(p);
  }
  return kept;
}

async function fetchPois(path, cum, categories, opt = {}) {
  const { corridorKm = 50, maxPer5km = 3, progress = () => {}, excludeIatas = [] } = opt;
  const cats = categories.filter(c => CATEGORIES[c]);
  if (!cats.length) return [];

  const hasArea = cats.some(c => CATEGORIES[c].area);
  const chunks = corridorChunks(path, cum, corridorKm * (hasArea ? 2 : 1));
  const collect = async (includeUnlinked, start, end, label) => {
    let done = 0, failed = 0, lastError = "";
    progress(start, `${label} (0/${chunks.length} segments)`);
    const seenIds = new Set();
    const found = [];
    await mapPool(chunks, CONCURRENCY, async chunk => {
      const res = await fetchBox(chunk.bbox, cats, 0, includeUnlinked);
      failed += res.failed;
      if (res.error) lastError = res.error;
      for (const el of res.elements) {
        const id = el.type + "/" + el.id;
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        found.push({ el, lo: chunk.lo, hi: chunk.hi });
      }
      done++;
      progress(start + (end - start) * done / chunks.length, `${label} (${done}/${chunks.length} segments)`);
    });
    return { found, failed, lastError };
  };

  const toCandidates = found => {
    const seen = new Map();
    for (const { el, lo, hi } of found) {
      const tags = el.tags || {};
      const cat = classify(tags, cats);
      const name = tags["name:en"] || tags.name;

      if (!cat || !name) continue;
      if (cat === "Airport" && excludeIatas.includes(tags.iata)) continue;

      let lat, lon;
      if (el.center) { lat = el.center.lat; lon = el.center.lon; }
      else if (el.lat !== undefined) { lat = el.lat; lon = el.lon; }
      else continue;

      const loc = locate(lat, lon, path, cum, lo, hi);
      if (loc.offset > corridorKm * (CATEGORIES[cat].area ? 2 : 1)) continue;

      const key = cat + "|" + name.toLowerCase();
      const prev = seen.get(key);
      if (prev && prev.offset_km <= loc.offset) continue;

      seen.set(key, {
        name, category: cat, lat, lng: lon, km_along: loc.kmAlong,
        offset_km: loc.offset, side: loc.side, tags, osm: `${el.type || "node"}/${el.id}`
      });
    }
    return [...seen.values()];
  };

  let result = await collect(false, 0.02, 0.47, "Fetching POIs from OpenStreetMap");
  if (!result.found.length && result.failed) {
    throw new Error(`Failed to fetch POIs: OpenStreetMap servers are busy (${result.lastError}). Please try again in a minute.`);
  }

  let candidates = toCandidates(result.found);
  const canBroadenSearch = cats.some(category =>
    CATEGORIES[category].sel.some(selector => selector.includes('["wikidata"]'))
  );
  if (!candidates.length && canBroadenSearch) {
    progress(0.49, "No named POIs with Wikidata tags found; retrying without that requirement");
    const broader = await collect(true, 0.50, 0.95, "Searching for all named POIs");
    const combined = new Map(result.found.map(item => [`${item.el.type}/${item.el.id}`, item]));
    for (const item of broader.found) {
      const id = `${item.el.type}/${item.el.id}`;
      if (!combined.has(id)) combined.set(id, item);
    }
    result = {
      found: [...combined.values()],
      failed: result.failed + broader.failed,
      lastError: broader.lastError || result.lastError,
    };
    candidates = toCandidates(result.found);
    if (!result.found.length && result.failed) {
      throw new Error(`Failed to fetch POIs: OpenStreetMap servers are busy (${result.lastError}). Please try again in a minute.`);
    }
  }

  for (const p of candidates) p.importance = importance(p, corridorKm);
  const kept = thinByDensity(candidates, maxPer5km);
  kept.sort((a, b) => a.km_along - b.km_along);
  kept.candidateCount = candidates.length;
  kept.skippedSegments = result.failed;

  progress(1, `Kept the ${kept.length} most relevant of ${candidates.length} POIs`);
  return kept;
}

/* ---------- Wikipedia enrichment ---------- */
async function enrichFromWikipedia(pois, progress = () => {}) {
  const groups = {};
  for (const p of pois) {
    const wp = p.tags.wikipedia;
    if (wp && wp.includes(":")) {
      const i = wp.indexOf(":"), lang = wp.slice(0, i), title = wp.slice(i + 1);
      ((groups[lang] = groups[lang] || {})[title] = groups[lang][title] || []).push(p);
    }
  }
  const nTotal = Object.values(groups).reduce((s, g) => s + Object.keys(g).length, 0);
  let nDone = 0;
  const jobs = [];
  for (const [lang, titles] of Object.entries(groups)) {
    const keys = Object.keys(titles);
    for (let i = 0; i < keys.length; i += 20) jobs.push({ lang, titles, batch: keys.slice(i, i + 20) });
  }
  await mapPool(jobs, 6, async ({ lang, titles, batch }) => {
    {
      try {
        const qs = new URLSearchParams({ action: "query", format: "json", origin: "*", redirects: "1",
          prop: "extracts|pageimages", exintro: "1", explaintext: "1", exsentences: "2",
          exlimit: "max", piprop: "thumbnail", pithumbsize: "800", titles: batch.join("|") });
        const r = await fetch(`https://${lang}.wikipedia.org/w/api.php?${qs}`);
        const q = (await r.json()).query;
        const remap = {};
        (q.normalized || []).forEach(m => { remap[m.from] = m.to; });
        (q.redirects || []).forEach(m => { remap[m.from] = m.to; });
        const pages = {};
        Object.values(q.pages || {}).forEach(pg => { pages[pg.title] = pg; });
        for (const t of batch) {
          let f = t; for (let k = 0; k < 2; k++) f = remap[f] || f;
          const pg = pages[f];
          if (!pg) continue;
          for (const p of titles[t]) {
            if (pg.extract) p.wiki_extract = pg.extract.trim();
            if (pg.thumbnail) p.wiki_image = pg.thumbnail.source;
          }
        }
      } catch (e) { /* enrichment is best-effort */ }
      nDone += batch.length;
      progress(nDone / Math.max(nTotal, 1), `Fetching descriptions (${nDone}/${nTotal})`);
    }
  });
}

/* OSM "ele" is usually metres, sometimes "1234 m" or "4000 ft". */
function eleNum(t) {
  const raw = String((t && t.ele) || "").trim().toLowerCase();
  const n = parseFloat(raw.replace(",", "."));
  if (!isFinite(n)) return null;
  return /ft|feet|'/.test(raw) ? n * 0.3048 : n;
}
function fmtEle(ele) {
  const n = eleNum({ ele });
  return n == null ? null : Math.round(n).toLocaleString("en-GB") + " m";
}

/* ---------- rows + Excel ---------- */
const slug = s => (s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")) || "poi";

function toRows(pois) {
  const used = new Set();
  return pois.map(p => {
    const cat = CATEGORIES[p.category], t = p.tags;
    const base = slug(p.name);
    let id = base, k = 2;
    while (used.has(id)) id = `${base}-${k++}`;
    used.add(id);
    const ele = t.ele ? fmtEle(t.ele) : null;
    let subtitle = p.category;
    if ((p.category === "Mountain" || p.category === "Volcano") && ele) subtitle = ele;
    else if (p.category === "Airport" && t.iata) subtitle = "Airport " + t.iata;
    else if (p.category === "City" && /^\d+$/.test(t.population || "")) subtitle = "Population " + Number(t.population).toLocaleString("en-GB");
    const where = p.offset_km < 2 ? "directly on your flight path"
      : `about ${Math.round(p.offset_km)} km to the ${p.side} of your flight path`;
    const rising = ele && (p.category === "Mountain" || p.category === "Volcano") ? ` rising to ${ele}` : "";
    const desc = p.wiki_extract || `${p.name} is a ${p.category.toLowerCase()}${rising} located ${where}.`;
    const chips = [p.category];
    if (ele) chips.push(ele);
    if (p.category === "Airport" && t.iata) chips.push(t.iata);
    if (t.wikipedia) chips.push("Wikipedia");
    return [id, p.name, subtitle, p.category, desc, +p.lat.toFixed(5), +p.lng.toFixed(5), cat.trig,
      null, cat.colors[0], cat.colors[1], cat.colors[2], chips.join(CHIP_SEP), p.wiki_image || null];
  });
}

async function buildXlsx(ExcelJS, origin, dest, total, pois, path, cum) {
  const wb = new ExcelJS.Workbook();
  const head = ws => {
    ws.getRow(1).eachCell(c => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2A44" } };
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    });
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };
  const widths = (ws, arr) => arr.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const ws = wb.addWorksheet("POIs");
  ws.addRow(POI_COLUMNS);
  toRows(pois).forEach(r => ws.addRow(r));
  head(ws);
  widths(ws, [22, 28, 18, 14, 70, 10, 10, 16, 8, 16, 16, 13, 30, 40]);
  ws.autoFilter = { from: "A1", to: { row: 1, column: POI_COLUMNS.length } };
  for (let r = 2; r <= ws.rowCount; r++) ws.getCell(r, 5).alignment = { wrapText: true, vertical: "top" };

  const ws2 = wb.addWorksheet("Route Details");
  ws2.addRow(["order", "name", "category", "km_along_route", "offset_km", "side", "importance", "osm"]);
  pois.forEach((p, i) => ws2.addRow([i + 1, p.name, p.category, +p.km_along.toFixed(1), +p.offset_km.toFixed(1), p.side, p.importance, p.osm]));
  head(ws2); widths(ws2, [8, 30, 15, 16, 12, 8, 12, 18]);

  const ws3 = wb.addWorksheet("Route");
  ws3.addRow(["", "airport", "iata", "icao", "city", "country", "lat", "lng"]);
  [["From", origin], ["To", dest]].forEach(([l, a]) =>
    ws3.addRow([l, a.name, a.iata, a.icao, a.city, a.country, a.lat, a.lon]));
  ws3.addRow([]);
  ws3.addRow(["Distance (km)", +total.toFixed(1)]);
  ws3.addRow(["POI count", pois.length]);
  head(ws3); widths(ws3, [14, 36, 8, 8, 18, 9, 10, 10]);

  const ws4 = wb.addWorksheet("Flight Path");
  ws4.addRow(["km_along_route", "lat", "lng"]);
  const step = cum.length > 1 ? Math.max(1, Math.round(25 / (cum[1] - cum[0]))) : 1;
  const idx = [];
  for (let i = 0; i < path.length; i += step) idx.push(i);
  if (idx[idx.length - 1] !== path.length - 1) idx.push(path.length - 1);
  idx.forEach(i => ws4.addRow([+cum[i].toFixed(1), +path[i][0].toFixed(5), +path[i][1].toFixed(5)]));
  head(ws4);
  return wb.xlsx.writeBuffer();
}

/* ---------- one-call pipeline used by the UI and the tests ---------- */
async function buildRoute(AIRPORTS, ExcelJS, params, progress = () => {}) {
  progress(0.02, "Resolving airports");
  const a = resolveAirport(AIRPORTS, params.from), b = resolveAirport(AIRPORTS, params.to);
  const step = 10;
  const { path, cum, total } = greatCircle(a.lat, a.lon, b.lat, b.lon, step);
  const cats = params.categories && params.categories.length ? params.categories : DEFAULT_CATEGORIES;
  const pois = await fetchPois(path, cum, cats, { corridorKm: params.corridorKm, stepKm: step,
    maxPer5km: params.maxPer5km, excludeIatas: [a.iata, b.iata], progress: (f, m) => progress(0.05 + 0.75 * f, m) });
  if (params.enrich && pois.length) await enrichFromWikipedia(pois, (f, m) => progress(0.8 + 0.15 * f, m));
  progress(0.96, "Writing Excel file");
  const buffer = await buildXlsx(ExcelJS, a, b, total, pois, path, cum);

  const lons = unwrapLons(path.map(p => p[1]));
  const sub = Math.max(1, Math.round(25 / step));
  const mapPath = [];
  for (let i = 0; i < path.length; i += sub) mapPath.push([path[i][0], lons[i]]);
  if ((path.length - 1) % sub) mapPath.push([path[path.length - 1][0], lons[lons.length - 1]]);
  const outPois = pois.map(p => {
    let bi = 0, bd = Infinity;
    path.forEach((q, i) => { const d = haversine(p.lat, p.lng, q[0], q[1]); if (d < bd) { bd = d; bi = i; } });
    const k = Math.round((lons[bi] - p.lng) / 360);
    return { name: p.name, category: p.category, lat: p.lat, lng: p.lng, map_lng: p.lng + 360 * k,
      km_along: +p.km_along.toFixed(1), offset_km: +p.offset_km.toFixed(1), side: p.side };
  });
  progress(1, `Done: ${pois.length} POIs`);
  return {
    buffer, filename: `${a.iata}-${b.iata}_pois.xlsx`, distance_km: +total.toFixed(1),
    origin: { name: airportLabel(a), lat: a.lat, lng: lons[0] },
    dest: { name: airportLabel(b), lat: b.lat, lng: lons[lons.length - 1] },
    path: mapPath, pois: outPois, candidate_count: pois.candidateCount || pois.length,
    skipped_segments: pois.skippedSegments || 0,
    colors: Object.fromEntries(Object.entries(CATEGORIES).map(([c, v]) => [c, v.colors[2]])),
  };
}

if (typeof module !== "undefined") {
  module.exports = { CATEGORIES, DEFAULT_CATEGORIES, classify, POI_COLUMNS, searchAirports, resolveAirport, greatCircle, unwrapLons,
    haversine, buildRoute, airportLabel };
}


module.exports.thin=thinByDensity;module.exports.imp=importance;module.exports.split=splitBbox;module.exports.chunks=corridorChunks;