# Zaoflo — Setup Guide

## Stack
- **Next.js 14** (App Router) + TypeScript
- **Tailwind CSS**
- **Supabase** (Auth + PostgreSQL DB)
- **OpenRouter** (AI model access)
- **WordPress REST API** (Publishing)

---

## 1. Supabase Setup

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run each file in `supabase/migrations/` in filename order, starting with `001_initial.sql`
3. Copy your project URL and API keys from **Project Settings → API**

---

## 2. Environment Variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Fill in:
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Optional:
```
# Signs the client-portal access-code session cookie. Falls back to the
# service-role key if unset. Changing it sends every client back to the gate.
PORTAL_SESSION_SECRET=any-long-random-string
```

---

## 2b. Client Portal Access Codes

Every client link has a private 5-digit code, generated in the backend and shown
only in **Dashboard → Client Links**. Send the link and the code to the client
separately: the link on its own returns nothing until the code is entered.

- The code is checked on the server and never sent to the browser.
- A correct code sets a signed, http-only cookie good for 4 hours.
- Three wrong codes lock that link. It stays locked until you issue a new code
  — there is no timer to wait out.
- **New code** in the dashboard reissues it, ends every session opened with the
  old one immediately, and clears a lockout.

Requires `supabase/migrations/021_portal_access_code.sql`. It gives every
existing portal a fresh code, so links already in the wild need their new code
sent out.

---

## 3. Run the App

```bash
npm install
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

---

## 4. WordPress Plugin

1. Zip the `wordpress-plugin/zaoflo-connector/` folder
2. Go to your WordPress admin → **Plugins → Add New → Upload Plugin**
3. Upload the zip and activate
4. Go to **WordPress Admin → Zaoflo** to get your Secret Token
5. In your Zaoflo dashboard, add the site with:
   - WordPress URL
   - WordPress username + Application Password (from **Users → Profile → Application Passwords**)

---

## 5. OpenRouter API Key

1. Sign up at [openrouter.ai](https://openrouter.ai)
2. Create an API key at [openrouter.ai/keys](https://openrouter.ai/keys)
3. Paste it in **Zaoflo Dashboard → Settings → API**

---

## Architecture

```
Dashboard User
    │
    ├── Signs up / logs in (Supabase Auth)
    ├── Adds WordPress sites (REST API + App Password)
    ├── Writes or generates articles (OpenRouter AI)
    ├── Publishes immediately (WP REST API /wp-json/wp/v2/posts)
    └── Schedules an article → pushed to WordPress as a future post → WP publishes it

WordPress Plugin (optional enhancement):
    ├── Receives posts via /zaoflo/v1/publish
    ├── Queues scheduled posts
    └── Sends status callbacks to dashboard
```

---

## Publishing Flow

**Immediate publish:**
```
User clicks Publish → POST /api/publish → WordPress REST API → Post created → DB updated
```

**Scheduled publish:**
```
User picks a date/time (Schedules → calendar) → POST /api/publish with the UTC instant
→ WordPress post created with status=future + date_gmt → WordPress publishes it at that time
```
The app does not run a publishing cron; WordPress owns the timer once the post
is handed over. Pausing or archiving an article demotes that WP post back to a
draft (PATCH /api/articles/[id]/schedule) so it cannot go out.
