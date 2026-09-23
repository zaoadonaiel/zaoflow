# Zao Flo static-site receiver (reference)

The built-in `static` site_type in Zao Flo publishes by committing an
updated `content/articles.json` to a GitHub repo and letting the host
(Cloudflare Pages / Netlify / Vercel) rebuild on push. **You do not
need this receiver for that flow.**

This folder exists as a reference implementation for setups that
would rather run their own HTTP endpoint — self-hosted VPS, air-
gapped mirror, or a host without a Git-based pipeline.

## Contract

`POST /zaoflo/articles` with `Authorization: Bearer <shared secret>`:

```json
{
  "language": "en",
  "article": {
    "title": "…",
    "excerpt": "…",
    "slug": "…",
    "published_date": "2026-09-23T12:00:00Z",
    "body": "…"
  }
}
```

Returns `{ "id": "<slug>", "url": "https://…/articles/<slug>", "status": "publish" }`.

The receiver replaces an entry with the same slug or prepends a new
one, writes `content/articles.json`, and runs the configured
generator command to rebuild the site.

## Run

```
pip install flask
ZAOFLO_SECRET=changeme SITE_ROOT=/var/www/webdesignerpr \
  PUBLIC_BASE_URL=https://webdesignerpr.com \
  GENERATOR_CMD="python generate.py" \
  python receiver.py
```

Put it behind a TLS-terminating reverse proxy (Caddy, nginx). Point
the Zao Flo site's `node_api_url` at it and set `site_type = 'nodejs'`
if you go this route — the shape matches the Node.js receiver.
