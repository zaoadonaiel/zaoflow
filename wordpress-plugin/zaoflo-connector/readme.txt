=== Zaoflo Connector ===
Contributors: zaoflo
Tags: ai, seo, content, automation, publishing, openai, claude
Requires at least: 6.0
Tested up to: 6.7
Stable tag: 1.0.0
Requires PHP: 8.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Connect your WordPress site to Zaoflo — AI-powered SEO content publishing on autopilot.

== Description ==

Zaoflo Connector links your WordPress site to the Zaoflo dashboard, enabling:

* **AI-generated SEO content** published directly to your site
* **Scheduled autopublishing** — set a frequency (daily, weekly, monthly) and forget it
* **Status callbacks** — Zaoflo's dashboard gets real-time publish confirmations
* **Queue-based scheduling** — posts are queued and published by WP-Cron at the right time
* **SEO meta support** — meta descriptions are written to Yoast, Rank Math, and SEOPress fields automatically

**How to use:**

1. Install and activate this plugin.
2. Go to **WordPress Admin → Zaoflo** to get your Secret Token.
3. Add this site in your **Zaoflo Dashboard** with your WordPress URL + Application Password.
4. Paste the Secret Token into Zaoflo's site settings.
5. Done — Zaoflo can now publish to this site automatically.

**Note:** Basic publishing works WITHOUT this plugin via the WordPress REST API Application Password. This plugin adds enhanced features like scheduled queuing, status callbacks, and meta description support.

== Installation ==

1. Upload the `zaoflo-connector` folder to `/wp-content/plugins/`
2. Activate through the **Plugins** menu in WordPress
3. Go to **Zaoflo** in your WordPress admin menu to get your token

== Frequently Asked Questions ==

= Do I need this plugin to use Zaoflo? =
No. Basic publishing works via the WordPress REST API without this plugin. This plugin adds status callbacks, queue-based scheduling, and SEO meta support.

= Is the secret token secure? =
Yes. The token is a 256-bit random hex string generated on activation. All API requests are validated against this token.

= Can I regenerate the token? =
Yes, from the Zaoflo settings page in your WordPress admin. Remember to update it in your Zaoflo dashboard after regenerating.

== Changelog ==

= 1.0.0 =
* Initial release
* REST API endpoints for publish, queue, and status
* WP-Cron based scheduler for queued posts
* Admin settings page with token management
* Status callbacks to Zaoflo dashboard
* SEO meta description support (Yoast, Rank Math, SEOPress)
