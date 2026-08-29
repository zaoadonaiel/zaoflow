<?php
/**
 * Zaoflo Scheduler
 * Processes queued posts that are due for publishing.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class Zaoflo_Scheduler {

    /**
     * Called by WP-Cron hourly — processes items in the zaoflo_queue table that are due.
     */
    public static function process_scheduled_posts() {
        global $wpdb;

        $table = $wpdb->prefix . 'zaoflo_queue';
        $now   = current_time( 'mysql' );

        // Get pending items whose scheduled_at has passed
        $items = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT * FROM $table WHERE status = 'pending' AND (scheduled_at IS NULL OR scheduled_at <= %s) LIMIT 10",
                $now
            ),
            ARRAY_A
        );

        if ( empty( $items ) ) {
            return;
        }

        $dashboard_url = get_option( ZAOFLO_OPTION_DASHBOARD_URL, '' );
        $secret        = get_option( ZAOFLO_OPTION_SECRET, '' );

        foreach ( $items as $item ) {
            // Mark as processing
            $wpdb->update( $table, array( 'status' => 'processing' ), array( 'id' => $item['id'] ) );

            $post_id = wp_insert_post( array(
                'post_title'   => $item['title'],
                'post_content' => $item['content'],
                'post_excerpt' => $item['excerpt'],
                'post_status'  => 'publish',
                'post_type'    => 'post',
            ), true );

            if ( is_wp_error( $post_id ) ) {
                $wpdb->update( $table, array(
                    'status'        => 'failed',
                    'error_message' => $post_id->get_error_message(),
                    'processed_at'  => $now,
                ), array( 'id' => $item['id'] ) );

                self::notify_dashboard( $item['zaoflo_article_id'], 'failed', null, null, $post_id->get_error_message(), $dashboard_url, $secret );
                continue;
            }

            if ( ! empty( $item['zaoflo_article_id'] ) ) {
                update_post_meta( $post_id, '_zaoflo_article_id', $item['zaoflo_article_id'] );
            }

            $post_url = get_permalink( $post_id );

            $wpdb->update( $table, array(
                'status'       => 'published',
                'wp_post_id'   => $post_id,
                'processed_at' => $now,
            ), array( 'id' => $item['id'] ) );

            self::notify_dashboard( $item['zaoflo_article_id'], 'published', $post_id, $post_url, null, $dashboard_url, $secret );
        }
    }

    private static function notify_dashboard( $article_id, $status, $post_id, $post_url, $error, $dashboard_url, $secret ) {
        if ( empty( $dashboard_url ) || empty( $article_id ) ) {
            return;
        }

        $url = trailingslashit( $dashboard_url ) . 'api/webhook/wordpress';
        wp_remote_post( $url, array(
            'method'  => 'POST',
            'timeout' => 10,
            'headers' => array( 'Content-Type' => 'application/json' ),
            'body'    => wp_json_encode( array(
                'article_id'   => $article_id,
                'secret_token' => $secret,
                'status'       => $status,
                'wp_post_id'   => $post_id,
                'wp_post_url'  => $post_url,
                'error'        => $error,
            ) ),
        ) );
    }
}
