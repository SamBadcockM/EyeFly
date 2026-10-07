---
name: Overpass reliability
description: Why POI lookups use a same-origin proxy and several Overpass mirrors.
---

Keep Eyefly Route Builder POI lookups on `/api/overpass` and retain upstream mirror retries.

**Why:** The original Overpass endpoints returned HTTP 406/500 from this workspace, while OpenStreetMap France and Switzerland mirrors returned valid JSON. The proxy made successful route queries possible and avoids depending on one upstream.

**How to apply:** When changing POI discovery, keep the client calling the same-origin proxy and preserve mirror rotation, query validation, and response caching.
