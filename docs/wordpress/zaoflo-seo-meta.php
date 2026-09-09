<?php
/**
 * Plugin Name: Zao Flo SEO Meta Bridge
 * Description: Registers the meta keys the Zao Flo SEO Pages tool writes
 *              (Yoast SEO title/description/focus keyword/synonyms plus a
 *              theme "_location" flag) with `show_in_rest = true`, so the
 *              WP REST API accepts writes from Zao Flo instead of silently
 *              dropping them.
 * Author: Zao Flo
 * Version: 1.0.0
 *
 * INSTALL:
 *   1. Copy this file to `wp-content/mu-plugins/zaoflo-seo-meta.php` on
 *      the WordPress site. Create the `mu-plugins` directory if it doesn't
 *      exist — mu-plugins auto-load; there's no "activate" step.
 *   2. That's it. No dashboard toggle, no config.
 *
 * Alternative install path if you can't create `mu-plugins/`:
 *   - Drop it into `wp-content/plugins/` and activate it in the WP admin.
 *
 * The `_yoast_wpseo_*` keys are already registered by Yoast on most sites.
 * Re-registering with the same schema is safe — `register_post_meta` is
 * idempotent on identical calls. This file's real job is covering the
 * cases where Yoast's registration doesn't apply (page post type
 * deregistered, third-party plugin filtering meta from REST, etc.) and
 * adding the theme-specific `_location` key that Yoast doesn't touch.
 */

if (!defined('ABSPATH')) {
    exit; // Not called via WordPress — do nothing.
}

add_action('init', function () {
    $post_types = ['post', 'page'];

    $string_meta = [
        '_yoast_wpseo_title'            => 'edit_posts',
        '_yoast_wpseo_metadesc'         => 'edit_posts',
        '_yoast_wpseo_focuskw'          => 'edit_posts',
        '_yoast_wpseo_keywordsynonyms'  => 'edit_posts',
        '_location'                     => 'edit_posts',
    ];

    foreach ($post_types as $post_type) {
        foreach ($string_meta as $meta_key => $required_cap) {
            register_post_meta($post_type, $meta_key, [
                'type'          => 'string',
                'single'        => true,
                'show_in_rest'  => true,
                // Only users allowed to edit posts of this type may write the
                // meta over REST. Zao Flo authenticates with a WordPress
                // Application Password tied to a user; that user's role
                // decides whether writes are accepted.
                'auth_callback' => function () use ($required_cap) {
                    return current_user_can($required_cap);
                },
            ]);
        }
    }
});
