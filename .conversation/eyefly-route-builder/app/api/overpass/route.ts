import { createHash } from "node:crypto"

export const maxDuration = 120

const UPSTREAMS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
]
const DEADLINE_MS = 110_000
const ATTEMPT_TIMEOUT_MS = 75_000
const MAX_QUERY_LENGTH = 20_000
const MEMORY_LIMIT = 300
const memory = new Map<string, string>()

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function remember(key: string, body: string) {
  if (memory.size >= MEMORY_LIMIT) memory.delete(memory.keys().next().value as string)
  memory.set(key, body)
}

// Overpass reports timeouts / out-of-memory as HTTP 200 with a "remark"; those must not be cached.
function isGoodBody(body: string) {
  if (!body.trimStart().startsWith("{")) return false
  const tail = body.slice(-600)
  return !/"remark"\s*:\s*"[^"]*runtime error/i.test(tail) && !/"remark"\s*:\s*"[^"]*runtime error/i.test(body.slice(0, 600))
}

async function runQuery(query: string): Promise<{ body?: string; status: number }> {
  const started = Date.now()
  let lastStatus = 504
  for (let attempt = 0; attempt < 4; attempt++) {
    const remaining = DEADLINE_MS - (Date.now() - started)
    if (remaining < 5_000) break
    const res = await fetch(UPSTREAMS[attempt % UPSTREAMS.length], {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "route-poi-builder/1.0",
        Accept: "application/json",
      },
      body: "data=" + encodeURIComponent(query),
      cache: "no-store",
      signal: AbortSignal.timeout(Math.min(remaining, ATTEMPT_TIMEOUT_MS)),
    }).catch(() => null)

    if (res) {
      const body = await res.text().catch(() => "")
      if (res.ok && isGoodBody(body)) return { body, status: 200 }
      if (res.status === 400) return { status: 400 }
      lastStatus = res.ok ? 502 : res.status
    }
    await sleep(res?.status === 429 ? 3_000 : 1_000)
  }
  return { status: lastStatus }
}

export async function POST(request: Request) {
  const { query } = (await request.json().catch(() => ({}))) as { query?: unknown }
  if (typeof query !== "string" || !query.startsWith("[out:json]") || query.length > MAX_QUERY_LENGTH) {
    return Response.json({ error: "Invalid query" }, { status: 400 })
  }

  const key = createHash("sha256").update(query).digest("hex")
  const hit = memory.get(key)
  if (hit) return new Response(hit, { headers: { "Content-Type": "application/json", "X-Cache": "HIT" } })

  const { body, status } = await runQuery(query)
  if (!body) return Response.json({ error: `Upstream HTTP ${status}` }, { status: status >= 400 ? status : 502 })

  remember(key, body)
  return new Response(body, { headers: { "Content-Type": "application/json", "X-Cache": "MISS" } })
}
