<?php
/**
 * [zaoflow_page_buttons] — render a row of pill buttons that link to WP pages
 * by ID, with per-button labels supplied by the shortcode (position-matched
 * against `ids`). Styling comes entirely from the shortcode attributes so the
 * Zaoflo dashboard is the single source of truth for how a button row looks.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class Zaoflo_Page_Buttons {

    public static function register() {
        add_shortcode( 'zaoflow_page_buttons', array( __CLASS__, 'render' ) );
    }

    public static function render( $atts ) {
        $atts = shortcode_atts( array(
            'ids'          => '',
            'labels'       => '',
            'bg'           => '',
            'color'        => '',
            'outline'      => '',
            'outline_size' => '',
            'size'         => '',
        ), $atts, 'zaoflow_page_buttons' );

        $ids = array_values( array_filter( array_map( 'intval', explode( ',', (string) $atts['ids'] ) ) ) );
        if ( empty( $ids ) ) {
            return '';
        }
        $labels = array_map( 'trim', explode( '|', (string) $atts['labels'] ) );

        $bg           = self::normalize_hex( $atts['bg'] );
        $color        = self::normalize_hex( $atts['color'] );
        $outline      = self::normalize_hex( $atts['outline'] );
        $outline_size = self::normalize_outline_size( $atts['outline_size'] );
        $size         = self::normalize_size( $atts['size'] );

        $style_parts = array();
        if ( $bg !== '' )      { $style_parts[] = 'background-color:' . $bg; }
        if ( $color !== '' )   { $style_parts[] = 'color:' . $color; }
        if ( $outline !== '' ) { $style_parts[] = 'border:' . $outline_size . 'px solid ' . $outline; }
        if ( $size !== '' )    { $style_parts[] = 'font-size:' . $size; }
        $style_attr = ! empty( $style_parts )
            ? ' style="' . esc_attr( implode( ';', $style_parts ) ) . '"'
            : '';

        $out = self::maybe_print_base_styles();
        $out .= '<div class="zaoflow-page-buttons">';
        foreach ( $ids as $i => $id ) {
            $permalink = get_permalink( $id );
            if ( ! $permalink ) {
                continue;
            }
            $label = isset( $labels[ $i ] ) && $labels[ $i ] !== ''
                ? $labels[ $i ]
                : get_the_title( $id );
            $out .= sprintf(
                '<a class="zaoflow-page-button" href="%s"%s>%s</a>',
                esc_url( $permalink ),
                $style_attr,
                esc_html( $label )
            );
        }
        $out .= '</div>';
        return $out;
    }

    private static function normalize_hex( $value ) {
        $value = trim( (string) $value );
        if ( $value === '' ) {
            return '';
        }
        if ( $value[0] !== '#' ) {
            $value = '#' . $value;
        }
        if ( ! preg_match( '/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i', $value ) ) {
            return '';
        }
        return strtolower( $value );
    }

    /**
     * Clamp the outline width the dashboard sends to the same 1–5 range the UI
     * exposes. Bare integers only — a rogue value from a hand-edited shortcode
     * silently falls back to 1px so a stray "outline_size=999" can't blow the
     * layout out sideways.
     */
    private static function normalize_outline_size( $value ) {
        $n = (int) $value;
        if ( $n < 1 || $n > 5 ) {
            return 1;
        }
        return $n;
    }

    private static function normalize_size( $value ) {
        $value = trim( (string) $value );
        if ( $value === '' ) {
            return '';
        }
        if ( ! preg_match( '/^\d+(\.\d+)?(px|rem|em|%)?$/', $value ) ) {
            return '';
        }
        // Bare number → treat as px so the dashboard can send just "14".
        if ( preg_match( '/^\d+(\.\d+)?$/', $value ) ) {
            $value .= 'px';
        }
        return $value;
    }

    /**
     * Emit layout CSS exactly once per request. Only touches container spacing
     * and pill shape — every color/size decision lives on the inline style so
     * a theme override never fights the shortcode's own choices.
     */
    private static function maybe_print_base_styles() {
        static $printed = false;
        if ( $printed ) {
            return '';
        }
        $printed = true;
        return '<style id="zaoflow-page-buttons-base">'
            . '.zaoflow-page-buttons{display:flex;flex-wrap:wrap;gap:.5rem;margin:1rem 0;}'
            . '.zaoflow-page-button{display:inline-flex;align-items:center;padding:.5rem 1rem;border-radius:9999px;text-decoration:none;line-height:1.2;transition:opacity .15s ease;}'
            . '.zaoflow-page-button:hover{opacity:.85;text-decoration:none;}'
            . '</style>';
    }
}
