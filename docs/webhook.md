# Radar webhook connector

The **Webhook** blog connection sends each article to your own endpoint as signed JSON, so you can publish it anywhere
(a custom CMS, a static-site build, a queue). Radar never posts anywhere you didn't connect.

## Setup

1. Settings → Publishing → **Add connection** → **Webhook**.
2. Enter an **Endpoint URL**. It must use `https://`.
3. Radar generates a **signing secret** (`whsec_…`). It is shown once, while you create the connection: click the
   *Signing secret* field to reveal and select the full value, then store it in your server's environment.
   Afterwards Radar only shows the masked form (`whsec_7Kq2…f91A`); to get a new secret, disconnect and add the webhook again.
4. **Test connection** sends a `radar.test` event. Any `2xx` response passes.

## Requests

`POST {your endpoint}` with these headers:

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `User-Agent` | `Radar-Webhooks/1.0` |
| `Radar-Event` | `article.published` or `radar.test` |
| `Radar-Signature` | `t={unix seconds},v1={hex HMAC-SHA256}` (see below) |
| `Idempotency-Key` | The article id for `article.published` (stable across retries) |

Respond with any `2xx` within 20 seconds. Anything else (or a timeout) is a failure: Radar retries network errors,
`408`, `409`, `429` and `5xx` up to 3 times with backoff (30 s, 2 min, 8 min), then marks the article **Failed** and
shows your status code in Radar ("Webhook returned 500 Internal Server Error"). `4xx` responses are not retried.
Use the `Idempotency-Key` to ignore duplicates.

Optionally reply with JSON `{ "url": "https://yoursite.com/blog/…" }`: Radar stores it as the live post URL
(**View post**). Without it Radar uses `https://{your domain}/blog/{slug}`.

### `article.published`

```json
{
  "id": "evt_Jc2kq0dYwq8mVb4x",
  "type": "article.published",
  "created": "2026-10-20T13:00:04.210Z",
  "data": {
    "business": { "domain": "fieldnote.app", "name": "Fieldnote" },
    "article": {
      "id": "e_9f2c1a",
      "title": "How to price a freelance design project",
      "slug": "how-to-price-freelance-design-project",
      "html": "<p>…</p>\n<h2>…</h2>\n…",
      "markdown": "…",
      "meta_description": "A practical guide to pricing…",
      "keyword": "how to price freelance design",
      "publish_date": "2026-10-20",
      "canonical_url": null,
      "mode": "new",
      "refresh_url": null,
      "author": "Fieldnote",
      "featured_image": { "url": "https://app.radar…/api/files/…/hero.png", "alt": "A designer's desk with a pricing sheet" },
      "videos": [{ "id": "dQw4w9WgXcQ", "title": "…", "channel": "…", "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }],
      "sources": [{ "title": "Freelance rates survey 2026", "url": "https://example.org/survey" }]
    }
  }
}
```

| Field | Notes |
|---|---|
| `html` | Ready to render. YouTube embeds (with creator credit) follow the first section; sources are listed as citations at the end; approved Backlinks network links are already inserted with their `rel` and disclosure. |
| `markdown` | The same article as Markdown (videos as `<iframe>`). Approved network links are only in `html`. |
| `canonical_url` | Set for refresh articles (the existing page); otherwise `null` — the post's own URL is canonical. |
| `mode` / `refresh_url` | `refresh` articles rewrite an existing page at `refresh_url`. Update that page instead of creating a new one. |
| `featured_image` | 1200×628 PNG, or `null`. |

### `radar.test`

```json
{ "id": "evt_…", "type": "radar.test", "created": "…", "data": { "business": { "domain": "fieldnote.app", "name": "Fieldnote" }, "test": true } }
```

Don't publish anything for it — just return `2xx`.

## Verifying the signature

`v1` is the hex HMAC-SHA256 of the string `"{t}.{raw request body}"`, keyed with your full signing secret
(including the `whsec_` prefix). Verify against the **raw** body bytes, before JSON parsing, compare in constant time,
and reject timestamps older than 5 minutes to prevent replays.

### Node.js

```js
import crypto from 'node:crypto';

export function verifyRadar(rawBody, header, secret, toleranceSec = 300) {
  const parts = Object.fromEntries(String(header || '').split(',').map(p => p.split('=')));
  const t = Number(parts.t);
  if (!t || !parts.v1 || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(parts.v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Next.js route handler
export async function POST(req) {
  const raw = await req.text();
  if (!verifyRadar(raw, req.headers.get('radar-signature'), process.env.RADAR_WEBHOOK_SECRET)) return new Response('bad signature', { status: 401 });
  const evt = JSON.parse(raw);
  if (evt.type === 'article.published') { /* create the post from evt.data.article */ }
  return Response.json({ ok: true /*, url: 'https://yoursite.com/blog/…' */ });
}
```

### Python

```python
import hmac, hashlib, time

def verify_radar(raw_body: bytes, header: str, secret: str, tolerance: int = 300) -> bool:
    parts = dict(p.split("=", 1) for p in (header or "").split(",") if "=" in p)
    try:
        t = int(parts["t"])
    except (KeyError, ValueError):
        return False
    if abs(time.time() - t) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))
```
