"""Reference receiver for the Zao Flo static-site publish flow.

Not required for the Cloudflare Pages / GitHub-commit path that the
built-in `static` site_type uses — Zao Flo talks to GitHub directly
and Cloudflare Pages picks up the push. This file exists for setups
where you would rather run your own endpoint (self-hosted VPS, air-
gapped mirror, or a host without a Git-based deploy pipeline).

Contract mirrors the JSON entry the built-in publisher writes:

  POST /zaoflo/articles
    Authorization: Bearer <shared secret>
    { "language": "en",
      "article": {
        "title": "...",
        "excerpt": "...",
        "slug": "...",
        "published_date": "2026-09-23T12:00:00Z",
        "body": "..."
      } }

  200 OK { "id": "<slug>", "url": "https://.../articles/<slug>", "status": "publish" }

Behavior:
  - Loads `content/articles.json` (creates it if missing).
  - Replaces any existing entry with the same slug in the language
    bucket, otherwise prepends the new entry so newest is first.
  - Writes the file back and calls `on_rebuild()` — by default it
    just shells out to your Python generator. Swap in a git commit,
    an `rsync`, or a POST to a build hook as you need.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

from flask import Flask, jsonify, request

# --- config --- adjust these for your setup ---------------------------------
SHARED_SECRET = os.environ["ZAOFLO_SECRET"]  # matches sites.secret_token in Zao Flo
SITE_ROOT = Path(os.environ.get("SITE_ROOT", "/var/www/webdesignerpr"))
CONTENT_FILE = SITE_ROOT / "content" / "articles.json"
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "https://webdesignerpr.com")
GENERATOR_CMD = os.environ.get("GENERATOR_CMD", "python generate.py").split()
# ----------------------------------------------------------------------------

app = Flask(__name__)


def load_articles() -> dict:
    if not CONTENT_FILE.exists():
        return {}
    return json.loads(CONTENT_FILE.read_text(encoding="utf-8"))


def save_articles(data: dict) -> None:
    CONTENT_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONTENT_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def upsert(data: dict, language: str, entry: dict) -> dict:
    bucket = data.get(language) or {"articles": []}
    articles = bucket["articles"]
    for i, existing in enumerate(articles):
        if existing.get("slug") == entry["slug"]:
            articles[i] = entry
            break
    else:
        articles.insert(0, entry)
    data[language] = {"articles": articles}
    return data


def on_rebuild() -> None:
    """Regenerate the static site. Replace with your own deploy hook."""
    subprocess.run(GENERATOR_CMD, cwd=SITE_ROOT, check=True)


@app.post("/zaoflo/articles")
def publish():
    auth = request.headers.get("Authorization", "")
    if auth != f"Bearer {SHARED_SECRET}":
        return jsonify(error="unauthorized"), 401

    payload = request.get_json(silent=True) or {}
    language = payload.get("language", "en")
    article = payload.get("article") or {}

    required = {"title", "excerpt", "slug", "published_date", "body"}
    missing = required - article.keys()
    if missing:
        return jsonify(error=f"missing fields: {sorted(missing)}"), 400

    data = load_articles()
    data = upsert(data, language, article)
    save_articles(data)

    try:
        on_rebuild()
    except subprocess.CalledProcessError as e:
        # The write succeeded — surface the rebuild failure separately
        # so Zao Flo doesn't retry the publish and duplicate the entry.
        return jsonify(
            id=article["slug"],
            url=f"{PUBLIC_BASE_URL}/articles/{article['slug']}",
            status="publish",
            warning=f"rebuild command failed: {e}",
        ), 200

    return jsonify(
        id=article["slug"],
        url=f"{PUBLIC_BASE_URL}/articles/{article['slug']}",
        status="publish",
    ), 200


@app.get("/zaoflo/health")
def health():
    auth = request.headers.get("Authorization", "")
    if auth != f"Bearer {SHARED_SECRET}":
        return jsonify(error="unauthorized"), 401
    return jsonify(ok=True, siteName=os.environ.get("SITE_NAME", "static-site"))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8787")))
