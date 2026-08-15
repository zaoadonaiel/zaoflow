<?php
/**
 * Zaoflo REST API Handler
 * Registers and handles all REST API endpoints used by the Zaoflo dashboard.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class Zaoflo_API_Handler {

    const NAMESPACE = 'zaoflo/v1';

    public function register_routes() {
        // Status check — dashboard uses this to verify plugin is installed
        register_rest_route( self::NAMESPACE, '/status', array(
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => array( $this, 'get_status' ),
            'permission_callback' => array( $this, 'check_token' ),
        ) );

        // Receive and publish a post immediately
        register_rest_route( self::NAMESPACE, '/publish', array(
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => array( $this, 'publish_post' ),
            'permission_callback' => array( $this, 'check_token' ),
        ) );

        // Queue a post for scheduled publishing
        register_rest_route( self::NAMESPACE, '/queue', array(
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => array( $this, 'queue_post' ),
            'permission_callback' => array( $this, 'check_token' ),
        ) );

        // Get queue status
        register_rest_route( self::NAMESPACE, '/queue/(?P<id>[a-f0-9-]+)', array(
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => array( $this, 'get_queue_item' ),
            'permission_callback' => array( $this, 'check_token' ),
            'args'                => array(
                'id' => array(
                    'required'          => true,
                    'validate_callback' => function( $param ) {
                        return is_string( $param ) && strlen( $param ) > 0;
                    },
                ),
            ),
        ) );
    }

    // ============================================================
    // Token authentication
    // ============================================================
    public function check_token( WP_REST_Request $request ) {
        $token = $request->get_header( 'X-Zaoflo-Token' );
        if ( empty( $token ) ) {
            // Also check query param for status check
            $token = $request->get_param( 'token' );
        }

        $stored_token = get_option( ZAOFLO_OPTION_SECRET );
        if ( empty( $stored_token ) || ! hash_equals( $stored_token, (string) $token ) ) {
            return new WP_Error(
                'zaoflo_unauthorized',
                __( 'Invalid or missing Zaoflo token.', 'zaoflo-connector' ),
                array( 'status' => 403 )
            );
        }

        return true;
    }

    // ============================================================
    // GET /zaoflo/v1/status
    // ============================================================
    public function get_status( WP_REST_Request $request ) {
        global $wp_version;

        return rest_ensure_response( array(
            'success'          => true,
            'plugin_version'   => ZAOFLO_VERSION,
            'wordpress_version' => $wp_version,
            'site_name'        => get_bloginfo( 'name' ),
            'site_url'         => get_site_url(),
            'timezone'         => wp_timezone_string(),
            'rest_url'         => rest_url(),
        ) );
    }

    // ============================================================
    // POST /zaoflo/v1/publish
    // ============================================================
    public function publish_post( WP_REST_Request $request ) {
        $params = $request->get_json_params();

        $title           = sanitize_text_field( $params['title'] ?? '' );
        $content         = wp_kses_post( $params['content'] ?? '' );
        $excerpt         = sanitize_textarea_field( $params['excerpt'] ?? '' );
        $article_id      = sanitize_text_field( $params['article_id'] ?? '' );
        $post_status     = in_array( $params['status'] ?? 'publish', array( 'publish', 'draft', 'future' ), true )
                            ? $params['status']
                            : 'publish';
        $scheduled_at    = $params['scheduled_at'] ?? null;
        $categories      = array_map( 'absint', $params['categories'] ?? array() );
        $tags            = array_map( 'sanitize_text_field', $params['tags'] ?? array() );
        $meta_desc       = sanitize_text_field( $params['meta_description'] ?? '' );
        $dashboard_url   = get_option( ZAOFLO_OPTION_DASHBOARD_URL, '' );

        if ( empty( $title ) ) {
            return new WP_Error( 'zaoflo_missing_title', 'Title is required.', array( 'status' => 400 ) );
        }
        if ( empty( $content ) ) {
            return new WP_Error( 'zaoflo_missing_content', 'Content is required.', array( 'status' => 400 ) );
        }

        $post_date = null;
        if ( $post_status === 'future' && ! empty( $scheduled_at ) ) {
            $post_date = get_gmt_from_date( date( 'Y-m-d H:i:s', strtotime( $scheduled_at ) ) );
        }

        $post_data = array(
            'post_title'   => $title,
            'post_content' => $content,
            'post_excerpt' => $excerpt,
            'post_status'  => $post_status,
            'post_type'    => 'post',
        );

        if ( ! empty( $post_date ) ) {
            $post_data['post_date_gmt'] = $post_date;
        }

        if ( ! empty( $categories ) ) {
            $post_data['post_category'] = $categories;
        }

        $post_id = wp_insert_post( $post_data, true );

        if ( is_wp_error( $post_id ) ) {
            // Report failure back to dashboard
            $this->report_status_to_dashboard( $article_id, 'failed', null, null, $post_id->get_error_message(), $dashboard_url );
            return new WP_Error( 'zaoflo_publish_failed', $post_id->get_error_message(), array( 'status' => 500 ) );
        }

        // Add tags
        if ( ! empty( $tags ) ) {
            wp_set_post_tags( $post_id, $tags, false );
        }

        // Store meta description (works with Yoast, Rank Math, SEOPress)
        if ( ! empty( $meta_desc ) ) {
            update_post_meta( $post_id, '_yoast_wpseo_metadesc', $meta_desc );
            update_post_meta( $post_id, 'rank_math_description', $meta_desc );
            update_post_meta( $post_id, '_seopress_titles_desc', $meta_desc );
        }

        // Store Zaoflo article ID reference
        if ( ! empty( $article_id ) ) {
            update_post_meta( $post_id, '_zaoflo_article_id', $article_id );
        }

        $post_url = get_permalink( $post_id );

        // Report success back to Zaoflo dashboard
        $this->report_status_to_dashboard( $article_id, 'published', $post_id, $post_url, null, $dashboard_url );

        return rest_ensure_response( array(
            'success'    => true,
            'post_id'    => $post_id,
            'post_url'   => $post_url,
            'status'     => $post_status,
            'article_id' => $article_id,
        ) );
    }

    // ============================================================
    // POST /zaoflo/v1/queue
    // ============================================================
    public function queue_post( WP_REST_Request $request ) {
        global $wpdb;

        $params      = $request->get_json_params();
        $article_id  = sanitize_text_field( $params['article_id'] ?? '' );
        $title       = sanitize_text_field( $params['title'] ?? '' );
        $content     = wp_kses_post( $params['content'] ?? '' );
        $excerpt     = sanitize_textarea_field( $params['excerpt'] ?? '' );
        $scheduled_at = $params['scheduled_at'] ?? null;

        if ( empty( $title ) || empty( $content ) ) {
            return new WP_Error( 'zaoflo_missing_fields', 'Title and content are required.', array( 'status' => 400 ) );
        }

        $table = $wpdb->prefix . 'zaoflo_queue';
        $inserted = $wpdb->insert( $table, array(
            'zaoflo_article_id' => $article_id,
            'title'             => $title,
            'content'           => $content,
            'excerpt'           => $excerpt,
            'status'            => 'pending',
            'scheduled_at'      => $scheduled_at ? date( 'Y-m-d H:i:s', strtotime( $scheduled_at ) ) : null,
            'created_at'        => current_time( 'mysql' ),
        ) );

        if ( ! $inserted ) {
            return new WP_Error( 'zaoflo_queue_failed', 'Failed to queue post.', array( 'status' => 500 ) );
        }

        return rest_ensure_response( array(
            'success'    => true,
            'queue_id'   => $wpdb->insert_id,
            'article_id' => $article_id,
            'status'     => 'pending',
        ) );
    }

    // ============================================================
    // GET /zaoflo/v1/queue/{id}
    // ============================================================
    public function get_queue_item( WP_REST_Request $request ) {
        global $wpdb;

        $article_id = $request->get_param( 'id' );
        $table = $wpdb->prefix . 'zaoflo_queue';

        $item = $wpdb->get_row(
            $wpdb->prepare( "SELECT * FROM $table WHERE zaoflo_article_id = %s ORDER BY id DESC LIMIT 1", $article_id ),
            ARRAY_A
        );

        if ( ! $item ) {
            return new WP_Error( 'zaoflo_not_found', 'Queue item not found.', array( 'status' => 404 ) );
        }

        return rest_ensure_response( $item );
    }

    // ============================================================
    // Report publish status back to Zaoflo dashboard
    // ============================================================
    private function report_status_to_dashboard( $article_id, $status, $wp_post_id, $wp_post_url, $error, $dashboard_url ) {
        if ( empty( $dashboard_url ) || empty( $article_id ) ) {
            return;
        }

        $webhook_url = trailingslashit( $dashboard_url ) . 'api/webhook/wordpress';
        $secret      = get_option( ZAOFLO_OPTION_SECRET );

        wp_remote_post( $webhook_url, array(
            'method'  => 'POST',
            'timeout' => 10,
            'headers' => array( 'Content-Type' => 'application/json' ),
            'body'    => wp_json_encode( array(
                'article_id'   => $article_id,
                'secret_token' => $secret,
                'status'       => $status,
                'wp_post_id'   => $wp_post_id,
                'wp_post_url'  => $wp_post_url,
                'error'        => $error,
            ) ),
        ) );
    }
}
