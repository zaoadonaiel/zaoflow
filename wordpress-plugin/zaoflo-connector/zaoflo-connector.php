<?php
/**
 * Plugin Name: Zaoflo Connector
 * Plugin URI: https://zaoflo.com
 * Description: Connect your WordPress site to Zaoflo — AI-powered SEO content publishing on autopilot.
 * Version: 1.0.0
 * Author: Zaoflo
 * Author URI: https://zaoflo.com
 * License: GPL v2 or later
 * Text Domain: zaoflo-connector
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

define( 'ZAOFLO_VERSION', '1.0.0' );
define( 'ZAOFLO_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'ZAOFLO_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
define( 'ZAOFLO_OPTION_SECRET', 'zaoflo_secret_token' );
define( 'ZAOFLO_OPTION_DASHBOARD_URL', 'zaoflo_dashboard_url' );

// ============================================================
// Load includes
// ============================================================
require_once ZAOFLO_PLUGIN_DIR . 'includes/class-api-handler.php';
require_once ZAOFLO_PLUGIN_DIR . 'includes/class-scheduler.php';
require_once ZAOFLO_PLUGIN_DIR . 'admin/admin-page.php';

// ============================================================
// Bootstrap
// ============================================================
function zaoflo_init() {
    // Register REST API routes
    add_action( 'rest_api_init', function() {
        $api = new Zaoflo_API_Handler();
        $api->register_routes();
    } );

    // Register admin menu
    add_action( 'admin_menu', 'zaoflo_admin_menu' );

    // Enqueue admin assets
    add_action( 'admin_enqueue_scripts', 'zaoflo_enqueue_admin_assets' );

    // Activation hook: generate secret token
    register_activation_hook( __FILE__, 'zaoflo_activate' );
    register_deactivation_hook( __FILE__, 'zaoflo_deactivate' );

    // Schedule events
    add_action( 'zaoflo_process_scheduled', array( 'Zaoflo_Scheduler', 'process_scheduled_posts' ) );
}
add_action( 'plugins_loaded', 'zaoflo_init' );

// ============================================================
// Activation / Deactivation
// ============================================================
function zaoflo_activate() {
    // Generate a secret token if one doesn't exist
    if ( ! get_option( ZAOFLO_OPTION_SECRET ) ) {
        $token = bin2hex( random_bytes( 32 ) );
        update_option( ZAOFLO_OPTION_SECRET, $token );
    }

    // Set up recurring cron to check scheduled posts
    if ( ! wp_next_scheduled( 'zaoflo_process_scheduled' ) ) {
        wp_schedule_event( time(), 'hourly', 'zaoflo_process_scheduled' );
    }

    // Create custom table for scheduled items
    zaoflo_create_tables();
}

function zaoflo_deactivate() {
    wp_clear_scheduled_hook( 'zaoflo_process_scheduled' );
}

// ============================================================
// Database tables
// ============================================================
function zaoflo_create_tables() {
    global $wpdb;
    $charset_collate = $wpdb->get_charset_collate();
    $table_name = $wpdb->prefix . 'zaoflo_queue';

    $sql = "CREATE TABLE IF NOT EXISTS $table_name (
        id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
        zaoflo_article_id varchar(36) NOT NULL,
        title text NOT NULL,
        content longtext NOT NULL,
        excerpt text,
        status varchar(20) NOT NULL DEFAULT 'pending',
        scheduled_at datetime DEFAULT NULL,
        processed_at datetime DEFAULT NULL,
        wp_post_id bigint(20) unsigned DEFAULT NULL,
        error_message text DEFAULT NULL,
        created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY zaoflo_article_id (zaoflo_article_id),
        KEY status (status),
        KEY scheduled_at (scheduled_at)
    ) $charset_collate;";

    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    dbDelta( $sql );
}

// ============================================================
// Admin assets
// ============================================================
function zaoflo_enqueue_admin_assets( $hook ) {
    if ( $hook !== 'toplevel_page_zaoflo-connector' ) {
        return;
    }
    wp_enqueue_style(
        'zaoflo-admin',
        ZAOFLO_PLUGIN_URL . 'admin/admin.css',
        array(),
        ZAOFLO_VERSION
    );
}
