import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  QueryOverpassBody,
  QueryOverpassResponse,
} from "@workspace/api-zod";

const UPSTREAMS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const MAX_ATTEMPTS = 5;
const DEADLINE_MS = 110_000;
const ATTEMPT_TIMEOUT_MS = 45_000;
const CACHE_TTL_MS = 10 * 60_000;
const MAX_CACHE_ENTRIES = 80;

const cache = new Map<string, { body: string; expiresAt: number }>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const router: IRouter = Router();

function parseUsableResponse(body: string): boolean {
  if (!body.trimStart().startsWith("{")) return false;

  try {
    const value = JSON.parse(body) as { remark?: unknown };
    if (typeof value.remark === "string" && /runtime error/i.test(value.remark)) {
      return false;
    }
    return QueryOverpassResponse.safeParse(value).success;
  } catch {
    return false;
  }
}

function cacheResponse(key: string, body: string): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { body, expiresAt: Date.now() + CACHE_TTL_MS });
}

router.post("/overpass", async (req, res): Promise<void> => {
  const parsedBody = QueryOverpassBody.safeParse(req.body);
  if (!parsedBody.success || !parsedBody.data.query.startsWith("[out:json]")) {
    res.status(400).json({ error: "Invalid Overpass query" });
    return;
  }

  const { query } = parsedBody.data;
  const cacheKey = createHash("sha256").update(query).digest("hex");
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    res.setHeader("X-Cache", "HIT");
    res.type("application/json").send(cached.body);
    return;
  }
  if (cached) cache.delete(cacheKey);

  const startedAt = Date.now();
  let lastStatus = 502;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const remaining = DEADLINE_MS - (Date.now() - startedAt);
    if (remaining < 5_000) break;

    const upstream = UPSTREAMS[attempt % UPSTREAMS.length];
    let response: Response | null = null;
    try {
      response = await fetch(upstream, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "route-poi-builder/1.0",
          Accept: "application/json",
        },
        body: `data=${encodeURIComponent(query)}`,
        cache: "no-store",
        signal: AbortSignal.timeout(Math.min(remaining, ATTEMPT_TIMEOUT_MS)),
      });
    } catch (error) {
      lastStatus =
        error instanceof Error && error.name === "TimeoutError" ? 504 : 502;
    }

    if (response) {
      if (response.status === 400) {
        res.status(400).json({ error: "Overpass rejected the query" });
        return;
      }
      if (response.ok) {
        const body = await response.text().catch(() => "");
        if (parseUsableResponse(body)) {
          cacheResponse(cacheKey, body);
          res.setHeader("X-Cache", "MISS");
          res.type("application/json").send(body);
          return;
        }
        lastStatus = 502;
      } else {
        lastStatus = response.status;
      }
    }

    if (attempt < MAX_ATTEMPTS - 1) {
      await sleep(lastStatus === 429 ? 2_000 : 750);
    }
  }

  req.log.warn(
    { attempts: MAX_ATTEMPTS, upstreamStatus: lastStatus },
    "All Overpass upstreams failed",
  );
  res.status(502).json({
    error: `Overpass data service is temporarily unavailable (upstream HTTP ${lastStatus})`,
  });
});

export default router;
