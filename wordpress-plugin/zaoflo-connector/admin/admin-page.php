<?php
/**
 * Zaoflo admin settings page
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

function zaoflo_admin_menu() {
    add_menu_page(
        __( 'Zaoflo', 'zaoflo-connector' ),
        __( 'Zaoflo', 'zaoflo-connector' ),
        'manage_options',
        'zaoflo-connector',
        'zaoflo_admin_page',
        'data:image/svg+xml;base64,' . base64_encode( '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>' ),
        80
    );
}

function zaoflo_admin_page() {
    if ( isset( $_POST['zaoflo_save'] ) && check_admin_referer( 'zaoflo_settings' ) ) {
        $dashboard_url = esc_url_raw( sanitize_text_field( $_POST['zaoflo_dashboard_url'] ?? '' ) );
        update_option( ZAOFLO_OPTION_DASHBOARD_URL, $dashboard_url );
        echo '<div class="notice notice-success"><p>' . esc_html__( 'Settings saved.', 'zaoflo-connector' ) . '</p></div>';
    }

    if ( isset( $_POST['zaoflo_regen_token'] ) && check_admin_referer( 'zaoflo_settings' ) ) {
        $token = bin2hex( random_bytes( 32 ) );
        update_option( ZAOFLO_OPTION_SECRET, $token );
        echo '<div class="notice notice-warning"><p>' . esc_html__( 'Token regenerated. Update it in your Zaoflo dashboard.', 'zaoflo-connector' ) . '</p></div>';
    }

    $secret_token  = get_option( ZAOFLO_OPTION_SECRET, '' );
    $dashboard_url = get_option( ZAOFLO_OPTION_DASHBOARD_URL, '' );
    $api_base      = rest_url( 'zaoflo/v1' );
    ?>
    <div class="wrap zaoflo-admin">
        <div class="zaoflo-header">
            <h1>⚡ Zaoflo Connector</h1>
            <p class="zaoflo-tagline">AI WordPress Publishing Autopilot</p>
        </div>

        <div class="zaoflo-card">
            <h2>🔌 Connection Details</h2>
            <p>Copy these values into your <a href="<?php echo esc_url( $dashboard_url ?: 'https://zaoflo.com' ); ?>" target="_blank">Zaoflo Dashboard</a> when adding this site.</p>

            <table class="zaoflo-table">
                <tr>
                    <th>Plugin Status</th>
                    <td><span class="zaoflo-badge zaoflo-badge--success">✓ Active v<?php echo esc_html( ZAOFLO_VERSION ); ?></span></td>
                </tr>
                <tr>
                    <th>Site URL</th>
                    <td><code><?php echo esc_html( get_site_url() ); ?></code></td>
                </tr>
                <tr>
                    <th>REST API Base</th>
                    <td><code><?php echo esc_html( $api_base ); ?></code></td>
                </tr>
                <tr>
                    <th>Secret Token</th>
                    <td>
                        <div class="zaoflo-token-row">
                            <code id="zaoflo-token" class="zaoflo-token"><?php echo esc_html( $secret_token ); ?></code>
                            <button type="button" class="button" onclick="zaofloClipboard()">Copy</button>
                        </div>
                        <p class="description">Keep this private. Use it in Zaoflo settings to authenticate publishing.</p>
                    </td>
                </tr>
            </table>
        </div>

        <div class="zaoflo-card">
            <h2>⚙️ Settings</h2>
            <form method="POST">
                <?php wp_nonce_field( 'zaoflo_settings' ); ?>

                <table class="form-table">
                    <tr>
                        <th><label for="zaoflo_dashboard_url">Zaoflo Dashboard URL</label></th>
                        <td>
                            <input type="url" id="zaoflo_dashboard_url" name="zaoflo_dashboard_url"
                                value="<?php echo esc_attr( $dashboard_url ); ?>"
                                placeholder="https://app.zaoflo.com"
                                class="regular-text" />
                            <p class="description">Used to send publish status callbacks back to your dashboard.</p>
                        </td>
                    </tr>
                </table>

                <p class="submit">
                    <input type="submit" name="zaoflo_save" class="button button-primary" value="Save Settings" />
                </p>
            </form>
        </div>

        <div class="zaoflo-card zaoflo-card--danger">
            <h2>🔑 Regenerate Token</h2>
            <p>Only do this if your current token has been compromised. You will need to update the token in your Zaoflo dashboard after regenerating.</p>
            <form method="POST">
                <?php wp_nonce_field( 'zaoflo_settings' ); ?>
                <input type="submit" name="zaoflo_regen_token" class="button" value="Regenerate Token" onclick="return confirm('Are you sure? You will need to update the token in Zaoflo.')" />
            </form>
        </div>

        <div class="zaoflo-card">
            <h2>📖 How It Works</h2>
            <ol>
                <li>Copy your <strong>Site URL</strong> and <strong>Secret Token</strong> above.</li>
                <li>Go to your <a href="<?php echo esc_url( $dashboard_url ?: 'https://zaoflo.com' ); ?>" target="_blank">Zaoflo Dashboard</a> → Sites → Add Site.</li>
                <li>Enter your WordPress URL and Application Password (from <strong>Users → Profile → Application Passwords</strong>).</li>
                <li>Paste the Secret Token into the Zaoflo site settings.</li>
                <li>Zaoflo will now publish directly to this WordPress site, and this plugin will send status confirmations back.</li>
            </ol>
        </div>
    </div>

    <script>
    function zaofloClipboard() {
        var text = document.getElementById('zaoflo-token').textContent;
        navigator.clipboard.writeText(text).then(function() {
            alert('Token copied to clipboard!');
        });
    }
    </script>
    <?php
}
