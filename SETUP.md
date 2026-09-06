# Zaoflo — Setup Guide

## Stack
- **Next.js 14** (App Router) + TypeScript
- **Tailwind CSS**
- **Supabase** (Auth + PostgreSQL DB)
- **Trigger.dev v3** (Background jobs & scheduling)
- **OpenRouter** (AI model access)
- **WordPress REST API** (Publishing)

---

## 1. Supabase Setup

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run each file in `supabase/migrations/` in filename order, starting with `001_initial.sql`
3. Copy your project URL and API keys from **Project Settings → API**

---

## 2. Trigger.dev Setup

1. Create an account at [trigger.dev](https://trigger.dev)
2. Create a new project — note the Project ID
3. Copy your API keys from **Project Settings**

---

## 3. Environment Variables

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
TRIGGER_API_KEY=tr_dev_...
TRIGGER_PROJECT_ID=proj_...
NEXT_PUBLIC_TRIGGER_PUBLIC_API_KEY=pk_dev_...

# Google (Analytics + Search Console) — required for the /analytics page.
# Without these, the "Connect Google" button will error at the redirect step.
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/api/google/callback
```

**Google Cloud Console setup:**
1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create/select a project.
2. **APIs & Services → Library** — enable:
   - Google Analytics Admin API
   - Google Analytics Data API
   - Search Console API
3. **APIs & Services → OAuth consent screen** — configure (External is fine for testing); add your Google account as a Test user while the app is in "Testing" status.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID** — Application type: Web application.
5. Add every environment's callback URL to **Authorized redirect URIs**:
   - `http://localhost:3000/api/google/callback` (local dev)
   - `https://<your-domain>/api/google/callback` (production)
   - Any Vercel preview URL you want the connect button to work on
6. Copy the client ID and secret into the three env vars above. `GOOGLE_OAUTH_REDIRECT_URI` must exactly match one of the Authorized redirect URIs you registered — trailing slashes, `http` vs `https`, and port all matter.

**On Vercel:** set the same three vars in **Project → Settings → Environment Variables** for each environment you plan to use (Production / Preview / Development). Redeploy after adding them — Next.js reads env at build time for server routes.

---

## 4. Run the App

```bash
npm install
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

---

## 5. Run Trigger.dev (dev mode)

In a separate terminal:
```bash
npx trigger.dev@latest dev
```

This connects to the Trigger.dev cloud and runs your scheduled tasks locally.

---

## 6. WordPress Plugin

1. Zip the `wordpress-plugin/zaoflo-connector/` folder
2. Go to your WordPress admin → **Plugins → Add New → Upload Plugin**
3. Upload the zip and activate
4. Go to **WordPress Admin → Zaoflo** to get your Secret Token
5. In your Zaoflo dashboard, add the site with:
   - WordPress URL
   - WordPress username + Application Password (from **Users → Profile → Application Passwords**)

---

## 7. OpenRouter API Key

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
    └── Sets schedule → Trigger.dev checks every hour → auto-generates + publishes

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
User sets schedule → schedule saved to DB → Trigger.dev cron (hourly)
→ finds due schedules → generates article (OpenRouter) → publishes to WordPress → DB updated
```
