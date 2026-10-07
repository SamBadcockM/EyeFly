import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  QueryWikidataPoisBody,
  QueryWikidataPoisResponse,
} from "@workspace/api-zod";

const UPSTREAM = "https://query.wikidata.org/sparql";
const UPSTREAM_TIMEOUT_MS = 35_000;
const MAX_ATTEMPTS = 2;
const CACHE_TTL_MS = 10 * 60_000;
const MAX_CACHE_ENTRIES = 40;

const CATEGORY_TYPE_RULES = [
  { category: "World Heritage Site", query: "world heritage", matches: /world heritage/i },
  { category: "Mountain Range", query: "mountain range", matches: /mountain range/i },
  { category: "Mountain", query: "mountain|peak|summit", matches: /mountain|\bpeak\b|\bsummit\b/i },
  { category: "Volcano", query: "volcano", matches: /volcano/i },
  { category: "Crater", query: "crater", matches: /crater/i },
  { category: "Glacier", query: "glacier|ice cap|ice field", matches: /glacier|ice cap|ice field/i },
  { category: "Desert", query: "desert", matches: /desert/i },
  { category: "Canyon & Valley", query: "canyon|valley|gorge", matches: /canyon|valley|gorge/i },
  { category: "Cliff & Ridge", query: "cliff|ridge|escarpment|arete", matches: /cliff|ridge|escarpment|arete|arête/i },
  { category: "Hot Spring & Geyser", query: "hot spring|geyser", matches: /hot spring|geyser/i },
  { category: "Cave", query: "cave|cavern", matches: /cave|cavern/i },
  { category: "Island", query: "island|archipelago", matches: /island|archipelago/i },
  { category: "National Park", query: "national park|protected area", matches: /national park|protected area/i },
  { category: "Forest", query: "forest|woods", matches: /forest|woods/i },
  { category: "River", query: "river", matches: /river/i },
  { category: "Lake", query: "lake|reservoir|lagoon", matches: /lake|reservoir|lagoon/i },
  { category: "Waterfall", query: "waterfall|cascade", matches: /waterfall|cascade/i },
  { category: "Sea & Coast", query: "sea|ocean|bay|strait|cape|peninsula|reef|coast", matches: /sea|ocean|bay|strait|cape|peninsula|reef|coast/i },
  { category: "Wetland & Delta", query: "wetland|delta|marsh|swamp", matches: /wetland|delta|marsh|swamp/i },
  { category: "Beach", query: "beach", matches: /beach/i },
  { category: "City", query: "city", matches: /\bcity\b/i },
  { category: "Town", query: "town", matches: /\btown\b/i },
  { category: "Landmark", query: "tourist attraction|landmark|monument|castle|fort|lighthouse|tower", matches: /tourist attraction|landmark|monument|castle|fort|lighthouse|tower/i },
  { category: "Archaeological Site", query: "archaeological site|ruins|ruin", matches: /archaeological site|ruins?|archaeology/i },
  { category: "Religious Site", query: "place of worship|structure of worship|religious building|cathedral|mosque|temple|church|shrine|monastery", matches: /place of worship|structure of worship|religious building|cathedral|mosque|temple|church|shrine|monastery/i },
  { category: "Airport", query: "airport|airfield", matches: /airport|airfield/i },
  { category: "Port & Harbour", query: "port|harbour|harbor", matches: /port|harbou?r/i },
  { category: "Dam", query: "dam", matches: /dam/i },
  { category: "Bridge", query: "bridge", matches: /bridge/i },
  { category: "Observatory", query: "observatory", matches: /observatory/i },
  { category: "Stadium & Track", query: "stadium|raceway|racetrack", matches: /stadium|raceway|racetrack/i },
  { category: "Theme Park", query: "theme park|amusement park", matches: /theme park|amusement park/i },
  { category: "Power Station", query: "power station|power plant", matches: /power station|power plant/i },
  { category: "Mine & Quarry", query: "mine|quarry", matches: /mine|quarry/i },
  { category: "Ski Resort", query: "ski resort|ski area", matches: /ski resort|ski area/i },
] as const;

type PoiElement = {
  type: "wikidata";
  id: number;
  lat: number;
  lon: number;
  category: string;
  wikidata: string;
  tags: Record<string, string>;
};

type SparqlBinding = { value?: unknown };
type SparqlRow = Record<string, SparqlBinding | undefined>;
type SparqlResponse = { results?: { bindings?: SparqlRow[] } };

const router: IRouter = Router();
const responseCache = new Map<string, { body: string; expiresAt: number }>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function textValue(row: SparqlRow, key: string): string | undefined {
  const value = row[key]?.value;
  return typeof value === "string" ? value : undefined;
}

function parseCoordinates(value: string): { lat: number; lon: number } | null {
  const number = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
  const match = new RegExp(`Point\\(\\s*(${number})\\s+(${number})\\s*\\)`, "i").exec(value);
  if (!match) return null;

  const lon = Number(match[1]);
  const lat = Number(match[2]);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return null;
  }
  return { lat, lon };
}

function wikipediaTitle(value: string | undefined): string | undefined {
  if (!value?.startsWith("https://en.wikipedia.org/wiki/")) return undefined;
  const encodedTitle = value.slice("https://en.wikipedia.org/wiki/".length).split(/[?#]/, 1)[0];
  try {
    return decodeURIComponent(encodedTitle.replace(/_/g, " "));
  } catch {
    return encodedTitle.replace(/_/g, " ");
  }
}

function buildSparqlQuery(
  centers: Array<{ lat: number; lon: number }>,
  radiusKm: number,
  typePattern: string,
): string {
  const centerValues = centers
    .map(({ lat, lon }) => `"Point(${lon.toFixed(5)} ${lat.toFixed(5)})"^^geo:wktLiteral`)
    .join("\n    ");

  return `
PREFIX bd: <http://www.bigdata.com/rdf#>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX schema: <http://schema.org/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wikibase: <http://wikiba.se/ontology#>

SELECT DISTINCT ?item ?itemLabel ?location ?typeLabel ?description ?article WHERE {
  VALUES ?center {
    ${centerValues}
  }
  SERVICE wikibase:around {
    ?item wdt:P625 ?location .
    bd:serviceParam wikibase:center ?center ;
                    wikibase:radius "${radiusKm}" ;
                    wikibase:distance ?distance .
  }
  ?item wdt:P31 ?type .
  ?type rdfs:label ?typeLabel .
  FILTER(LANG(?typeLabel) = "en")
  FILTER(REGEX(LCASE(STR(?typeLabel)), ${JSON.stringify(typePattern)}))
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en" .
  }
  OPTIONAL {
    ?item schema:description ?description .
    FILTER(LANG(?description) = "en")
  }
  OPTIONAL {
    ?article schema:about ?item ;
             schema:inLanguage "en" ;
             schema:isPartOf <https://en.wikipedia.org/> .
  }
}
LIMIT 3000
`.trim();
}

function parseRows(rows: SparqlRow[], selectedCategories: Set<string>): PoiElement[] {
  const elements = new Map<string, PoiElement>();

  for (const row of rows) {
    const itemUri = textValue(row, "item");
    const qid = itemUri?.match(/\/(Q[1-9]\d*)$/)?.[1];
    const name = textValue(row, "itemLabel")?.trim();
    const typeLabel = textValue(row, "typeLabel");
    const coordinateValue = textValue(row, "location");
    if (!qid || !name || !typeLabel || !coordinateValue) continue;

    const categoryRule = CATEGORY_TYPE_RULES.find(
      (rule) => selectedCategories.has(rule.category) && rule.matches.test(typeLabel),
    );
    const coordinates = parseCoordinates(coordinateValue);
    if (!categoryRule || !coordinates) continue;

    const key = `${qid}|${categoryRule.category}`;
    if (elements.has(key)) continue;

    const tags: Record<string, string> = {
      name,
      "name:en": name,
      wikidata: qid,
    };
    const description = textValue(row, "description")?.trim();
    if (description) tags.description = description;
    const title = wikipediaTitle(textValue(row, "article"));
    if (title) tags.wikipedia = `en:${title}`;

    elements.set(key, {
      type: "wikidata",
      id: Number(qid.slice(1)),
      ...coordinates,
      category: categoryRule.category,
      wikidata: qid,
      tags,
    });
  }

  return [...elements.values()];
}

router.post("/wikidata-pois", async (req, res): Promise<void> => {
  const parsedBody = QueryWikidataPoisBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.message });
    return;
  }

  const { centers, radiusKm, categories } = parsedBody.data;
  const requestedCategories = new Set(categories);
  const selectedRules = CATEGORY_TYPE_RULES.filter((rule) =>
    requestedCategories.has(rule.category),
  );
  if (!selectedRules.length || selectedRules.length !== requestedCategories.size) {
    res.status(400).json({ error: "One or more POI categories are not supported." });
    return;
  }

  const typePattern = [...new Set(selectedRules.flatMap((rule) => rule.query))].join("|");
  const query = buildSparqlQuery(centers, radiusKm, typePattern);
  const cacheKey = createHash("sha256").update(query).digest("hex");
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    res.setHeader("X-Cache", "HIT");
    res.type("application/json").send(cached.body);
    return;
  }
  if (cached) responseCache.delete(cacheKey);

  let lastStatus = 502;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let response: Response | null = null;
    try {
      response = await fetch(UPSTREAM, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "User-Agent": "eyefly-route-builder/1.0 (Wikidata POI fallback)",
          Accept: "application/sparql-results+json",
        },
        body: new URLSearchParams({ query }).toString(),
        cache: "no-store",
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (error) {
      lastStatus =
        error instanceof Error && error.name === "TimeoutError" ? 504 : 502;
    }

    if (response) {
      if (response.ok) {
        try {
          const result = (await response.json()) as SparqlResponse;
          if (Array.isArray(result.results?.bindings)) {
            const elements = parseRows(result.results.bindings, requestedCategories);
            const validated = QueryWikidataPoisResponse.safeParse({ elements });
            if (validated.success) {
              const body = JSON.stringify(validated.data);
              if (responseCache.size >= MAX_CACHE_ENTRIES) {
                const oldestKey = responseCache.keys().next().value;
                if (oldestKey) responseCache.delete(oldestKey);
              }
              responseCache.set(cacheKey, {
                body,
                expiresAt: Date.now() + CACHE_TTL_MS,
              });
              res.setHeader("X-Cache", "MISS");
              res.type("application/json").send(body);
              return;
            }
            req.log.warn(
              { issues: validated.error.issues.length },
              "Wikidata results failed response validation",
            );
          }
        } catch (error) {
          req.log.warn(
            { error: error instanceof Error ? error.message : "unknown error" },
            "Could not parse Wikidata response",
          );
        }
        lastStatus = 502;
      } else {
        lastStatus = response.status;
      }
    }

    if (attempt < MAX_ATTEMPTS - 1 && [429, 502, 503, 504].includes(lastStatus)) {
      await sleep(1_000);
    } else if (attempt < MAX_ATTEMPTS - 1 && lastStatus === 502) {
      await sleep(1_000);
    }
  }

  req.log.warn({ upstreamStatus: lastStatus }, "Wikidata Query Service request failed");
  res.status(502).json({
    error: `Wikidata Query Service is temporarily unavailable (upstream HTTP ${lastStatus})`,
  });
});

export default router;
