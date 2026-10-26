<?php
/**
 * Plugin Name:       BrandRep Connector for WooCommerce
 * Plugin URI:        https://brandrep.onetoolz.com
 * Description:       Store-side referral adapter for the OneToolz BrandRep affiliate hub. Captures first-click referrals automatically when a partner link is clicked (no consent popup), lets customers link their BrandRep account, and associates paid orders with the hub over the signed BrandRep bridge. No commissions, coupons or checkout changes.
 * Version:           1.1.0
 * Author:            OneToolz
 * License:           GPL-2.0-or-later
 * Text Domain:       brandrep-connector
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * WC requires at least: 7.0
 * WC tested up to:   9.0
 *
 * Bridge protocol: hub repo docs/REFERRAL_BRIDGE.md ("Trusted referral bridge — inbound protocol v1").
 * Approved attribution policy: first-click / 7 days / no self-referrals (first-click-7d-no-self-v1).
 *
 * @package BrandRepConnector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'BRC_VERSION', '1.1.0' );
define( 'BRC_OPTION_KEY', 'brandrep_connector_settings' );
define( 'BRC_POLICY_VERSION', 'first-click-7d-no-self-v1' );
define( 'BRC_DEFAULT_HUB_URL', 'https://brandrep.onetoolz.com' );

/* -------------------------------------------------------------------------
 * HPOS compatibility
 * ---------------------------------------------------------------------- */
add_action(
	'before_woocommerce_init',
	function () {
		if ( class_exists( '\Automattic\WooCommerce\Utilities\FeaturesUtil' ) ) {
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
		}
	}
);

/* -------------------------------------------------------------------------
 * Settings helpers (single WP option array)
 * ---------------------------------------------------------------------- */

/**
 * @return array{enabled:int,hub_url:string,bridge_secret:string}
 */
function brc_settings() {
	$s = get_option( BRC_OPTION_KEY, array() );
	if ( ! is_array( $s ) ) {
		$s = array();
	}
	return array(
		'enabled'       => ! empty( $s['enabled'] ) ? 1 : 0,
		'hub_url'       => isset( $s['hub_url'] ) && '' !== $s['hub_url'] ? rtrim( (string) $s['hub_url'], '/' ) : BRC_DEFAULT_HUB_URL,
		'bridge_secret' => isset( $s['bridge_secret'] ) ? (string) $s['bridge_secret'] : '',
	);
}

/**
 * The bridge is usable only when enabled, a valid hub URL is set and the
 * secret satisfies the hub-side rule (32-256 characters).
 */
function brc_is_configured() {
	$s = brc_settings();
	if ( ! $s['enabled'] ) {
		return false;
	}
	if ( '' === $s['bridge_secret'] || strlen( $s['bridge_secret'] ) < 32 || strlen( $s['bridge_secret'] ) > 256 ) {
		return false;
	}
	return (bool) filter_var( $s['hub_url'], FILTER_VALIDATE_URL );
}

/* -------------------------------------------------------------------------
 * Activation / deactivation
 * ---------------------------------------------------------------------- */
register_activation_hook(
	__FILE__,
	function () {
		if ( false === get_option( BRC_OPTION_KEY, false ) ) {
			add_option(
				BRC_OPTION_KEY,
				array(
					'enabled'       => 0,
					'hub_url'       => BRC_DEFAULT_HUB_URL,
					'bridge_secret' => '',
				)
			);
		}
		brc_register_account_endpoint();
		flush_rewrite_rules();
	}
);

register_deactivation_hook(
	__FILE__,
	function () {
		flush_rewrite_rules();
	}
);

/* -------------------------------------------------------------------------
 * Cookies
 *
 * Host-only (empty domain), Secure on SSL, SameSite=Lax.
 * br_vid is HttpOnly (it is a secret visitor id; only its SHA-256 ever
 * leaves the server). br_ref / br_consent are read by PHP only as well.
 * ---------------------------------------------------------------------- */
function brc_set_cookie( $name, $value, $days, $httponly = true ) {
	$expires = time() + ( absint( $days ) * DAY_IN_SECONDS );
	if ( PHP_VERSION_ID >= 70300 ) {
		setcookie(
			$name,
			$value,
			array(
				'expires'  => $expires,
				'path'     => '/',
				'domain'   => '', // Host-only.
				'secure'   => is_ssl(),
				'httponly' => $httponly,
				'samesite' => 'Lax',
			)
		);
	} else {
		// PHP < 7.3 fallback (no SameSite support).
		setcookie( $name, $value, $expires, '/', '', is_ssl(), $httponly ); // phpcs:ignore WordPressVIPMinimum.Functions.RestrictedFunctions.cookies_setcookie
	}
	// Make the value visible to the rest of this request.
	$_COOKIE[ $name ] = $value;
}

function brc_clear_cookie( $name ) {
	if ( PHP_VERSION_ID >= 70300 ) {
		setcookie(
			$name,
			'',
			array(
				'expires'  => time() - HOUR_IN_SECONDS,
				'path'     => '/',
				'domain'   => '',
				'secure'   => is_ssl(),
				'httponly' => true,
				'samesite' => 'Lax',
			)
		);
	} else {
		setcookie( $name, '', time() - HOUR_IN_SECONDS, '/', '', is_ssl(), true ); // phpcs:ignore WordPressVIPMinimum.Functions.RestrictedFunctions.cookies_setcookie
	}
	unset( $_COOKIE[ $name ] );
}

function brc_valid_code( $code ) {
	return is_string( $code ) && 1 === preg_match( '/^[a-f0-9]{32}$/', $code );
}

function brc_valid_vid( $vid ) {
	return is_string( $vid ) && 1 === preg_match( '/^[a-f0-9]{64}$/', $vid );
}

function brc_visitor_hash() {
	$vid = isset( $_COOKIE['br_vid'] ) ? sanitize_text_field( wp_unslash( $_COOKIE['br_vid'] ) ) : '';
	return brc_valid_vid( $vid ) ? hash( 'sha256', $vid ) : '';
}

/* -------------------------------------------------------------------------
 * Signed bridge transport
 *
 * Signature: lowercase hex HMAC-SHA256 with the bridge secret over
 * "timestamp.requestId.rawBody" — exactly as the hub verifies it.
 * Request IDs are generated once per event and reused on retries with an
 * identical body, per the bridge protocol.
 *
 * The secret and full bodies are NEVER logged. With WP_DEBUG on, only the
 * event kind and HTTP status code are written to the error log.
 * ---------------------------------------------------------------------- */
function brc_bridge_post( $body_array, $request_id, $bearer_token = '' ) {
	$s = brc_settings();

	$body = wp_json_encode( $body_array );
	if ( false === $body ) {
		return new WP_Error( 'brc_json', 'Could not encode bridge body.' );
	}

	$timestamp = (string) time();
	$signature = hash_hmac( 'sha256', $timestamp . '.' . $request_id . '.' . $body, $s['bridge_secret'] );

	$headers = array(
		'Content-Type'         => 'application/json',
		'x-brandrep-timestamp' => $timestamp,
		'x-brandrep-request-id' => $request_id,
		'x-brandrep-signature' => $signature,
	);
	if ( '' !== $bearer_token ) {
		$headers['Authorization'] = 'Bearer ' . $bearer_token;
	}

	$response = wp_remote_post(
		$s['hub_url'] . '/api/referrals/bridge',
		array(
			'timeout'     => 5,
			'sslverify'   => true,
			'redirection' => 0,
			'headers'     => $headers,
			'body'        => $body,
		)
	);

	if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
		$kind   = isset( $body_array['kind'] ) ? $body_array['kind'] : '?';
		$status = is_wp_error( $response ) ? 'transport-error' : (string) wp_remote_retrieve_response_code( $response );
		error_log( sprintf( 'BrandRep bridge %s event -> HTTP %s', $kind, $status ) ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
	}

	return $response;
}

function brc_bridge_accepted( $response ) {
	return ! is_wp_error( $response ) && 202 === wp_remote_retrieve_response_code( $response );
}

/* -------------------------------------------------------------------------
 * Referral capture
 *
 * A capture is sent once per (visitor, code): the hub preserves the first
 * unexpired touch, and locally a br_captured_<hash> cookie suppresses
 * duplicate sends from this browser.
 * ---------------------------------------------------------------------- */
function brc_captured_cookie_name( $visitor_hash, $code ) {
	return 'br_captured_' . substr( hash( 'sha256', $visitor_hash . '|' . $code ), 0, 24 );
}

function brc_maybe_send_capture() {
	if ( ! brc_is_configured() ) {
		return false;
	}
	$vid = isset( $_COOKIE['br_vid'] ) ? sanitize_text_field( wp_unslash( $_COOKIE['br_vid'] ) ) : '';
	$ref = isset( $_COOKIE['br_ref'] ) ? sanitize_text_field( wp_unslash( $_COOKIE['br_ref'] ) ) : '';
	if ( ! brc_valid_vid( $vid ) || ! brc_valid_code( $ref ) ) {
		return false;
	}
	// Auto-capture (v1.1.0): arriving via a referral link IS the capture
	// trigger — there is no consent banner or popup. Record consent
	// automatically so the order snapshot and the bridge event carry the
	// exact same consent:true contract as before. A legacy br_consent=no
	// left by the retired v1.0.0 banner is still honoured as an opt-out
	// remnant and blocks capture.
	if ( isset( $_COOKIE['br_consent'] ) && 'no' === $_COOKIE['br_consent'] ) {
		return false;
	}
	if ( ! isset( $_COOKIE['br_consent'] ) || 'yes' !== $_COOKIE['br_consent'] ) {
		brc_set_cookie( 'br_consent', 'yes', 365 );
	}

	$visitor_hash = hash( 'sha256', $vid );
	$flag         = brc_captured_cookie_name( $visitor_hash, $ref );
	if ( isset( $_COOKIE[ $flag ] ) ) {
		return false; // Already captured for this browser.
	}

	// Key order matches the bridge contract exactly; no extra keys.
	$body = array(
		'kind'          => 'capture',
		'visitorHash'   => $visitor_hash,
		'code'          => $ref,
		'consent'       => true,
		'policyVersion' => BRC_POLICY_VERSION,
	);

	$response = brc_bridge_post( $body, wp_generate_uuid4() );
	if ( brc_bridge_accepted( $response ) ) {
		brc_set_cookie( $flag, '1', 30 );
		return true;
	}
	// On failure no flag is set: a later page view will retry automatically.
	return false;
}

/* -------------------------------------------------------------------------
 * Front-end handling on template_redirect.
 *
 * template_redirect is used because cookies can still be set and a safe
 * redirect issued there; by the time templates render, headers are gone.
 * Chain handled once per request:
 *  1. ?br_ref=<code> landing  -> set first-touch cookies, auto-record
 *                                consent and send the capture immediately,
 *                                then strip the param.
 *  2. Plain page view         -> if referral cookies are present and no
 *                                capture was sent yet, send it now
 *                                (auto-recording consent the same way).
 * ---------------------------------------------------------------------- */
add_action( 'template_redirect', 'brc_handle_frontend', 1 );
function brc_handle_frontend() {
	if ( is_admin() || wp_doing_ajax() || wp_doing_cron() ) {
		return;
	}
	if ( ! isset( $_SERVER['REQUEST_METHOD'] ) || 'GET' !== strtoupper( sanitize_text_field( wp_unslash( $_SERVER['REQUEST_METHOD'] ) ) ) ) {
		return;
	}
	if ( ! brc_settings()['enabled'] ) {
		return; // Plugin disabled: no cookies, no calls.
	}

	$redirect_needed = false;

	/* 1. Referral landing ------------------------------------------------ */
	if ( isset( $_GET['br_ref'] ) ) {
		$code = strtolower( sanitize_text_field( wp_unslash( $_GET['br_ref'] ) ) );
		if ( brc_valid_code( $code ) ) {
			// Visitor id: mint once, keep for 30 days.
			$vid = isset( $_COOKIE['br_vid'] ) ? sanitize_text_field( wp_unslash( $_COOKIE['br_vid'] ) ) : '';
			if ( ! brc_valid_vid( $vid ) ) {
				try {
					$vid = bin2hex( random_bytes( 32 ) );
				} catch ( Exception $e ) {
					$vid = hash( 'sha256', wp_generate_uuid4() . wp_generate_uuid4() );
				}
				brc_set_cookie( 'br_vid', $vid, 30 );
			}
			// First-click: never overwrite an unexpired br_ref cookie.
			$existing = isset( $_COOKIE['br_ref'] ) ? sanitize_text_field( wp_unslash( $_COOKIE['br_ref'] ) ) : '';
			if ( ! brc_valid_code( $existing ) ) {
				brc_set_cookie( 'br_ref', $code, 7 );
			}
			// Auto-capture: clicking the referral link is the trigger.
			// brc_maybe_send_capture() records br_consent=yes itself
			// (unless a legacy opt-out stands) and sends the signed
			// capture event — no banner, no popup, no extra click.
			brc_maybe_send_capture();
		}
		$redirect_needed = true; // Always strip br_ref from the visible URL.
	}

	/* 2. Ordinary page view: retry a pending capture --------------------- */
	if ( ! $redirect_needed ) {
		brc_maybe_send_capture();
	}

	/* Strip handled params so they are never bookmarked/shared onward ---- */
	if ( $redirect_needed && ! headers_sent() ) {
		$target = remove_query_arg( array( 'br_ref', 'br_consent_choice', 'brc_nonce' ) );
		if ( $target ) {
			wp_safe_redirect( $target, 302 );
			exit;
		}
	}
}

/* -------------------------------------------------------------------------
 * Consent banner — REMOVED in v1.1.0.
 *
 * Referral capture is automatic: clicking a partner link records consent
 * and sends the capture (see brc_maybe_send_capture). There is no banner,
 * no popup, no AJAX consent endpoint and no front-end asset to enqueue.
 * ---------------------------------------------------------------------- */

/* -------------------------------------------------------------------------
 * Admin: WooCommerce -> BrandRep settings page
 * ---------------------------------------------------------------------- */
add_action( 'admin_menu', 'brc_register_settings_page' );
function brc_register_settings_page() {
	add_submenu_page(
		'woocommerce',
		__( 'BrandRep Connector', 'brandrep-connector' ),
		__( 'BrandRep', 'brandrep-connector' ),
		'manage_woocommerce',
		'brandrep-connector',
		'brc_render_settings_page'
	);
}

add_action( 'admin_post_brc_save_settings', 'brc_save_settings' );
function brc_save_settings() {
	if ( ! current_user_can( 'manage_woocommerce' ) ) {
		wp_die( esc_html__( 'Not allowed.', 'brandrep-connector' ) );
	}
	check_admin_referer( 'brc_save_settings' );

	$hub_url = isset( $_POST['brc_hub_url'] ) ? esc_url_raw( wp_unslash( $_POST['brc_hub_url'] ) ) : BRC_DEFAULT_HUB_URL;
	$secret  = isset( $_POST['brc_bridge_secret'] ) ? trim( sanitize_text_field( wp_unslash( $_POST['brc_bridge_secret'] ) ) ) : '';
	// An empty password submission keeps the stored secret.
	if ( '' === $secret ) {
		$secret = brc_settings()['bridge_secret'];
	}

	update_option(
		BRC_OPTION_KEY,
		array(
			'enabled'       => isset( $_POST['brc_enabled'] ) ? 1 : 0,
			'hub_url'       => '' !== $hub_url ? rtrim( $hub_url, '/' ) : BRC_DEFAULT_HUB_URL,
			'bridge_secret' => $secret,
		)
	);

	wp_safe_redirect( add_query_arg( array( 'page' => 'brandrep-connector', 'brc_notice' => 'saved' ), admin_url( 'admin.php' ) ) );
	exit;
}

/**
 * Test connection: reachability ONLY. Fetches a public hub page and checks
 * the response — it never sends a bridge event, so it can never create
 * referral evidence on the hub.
 */
add_action( 'admin_post_brc_test_connection', 'brc_test_connection' );
function brc_test_connection() {
	if ( ! current_user_can( 'manage_woocommerce' ) ) {
		wp_die( esc_html__( 'Not allowed.', 'brandrep-connector' ) );
	}
	check_admin_referer( 'brc_test_connection' );

	$s      = brc_settings();
	$result = 'fail';
	$resp   = wp_remote_get(
		$s['hub_url'] . '/program',
		array(
			'timeout'     => 5,
			'sslverify'   => true,
			'redirection' => 2,
		)
	);
	if ( ! is_wp_error( $resp ) ) {
		$code   = wp_remote_retrieve_response_code( $resp );
		$result = ( $code >= 200 && $code < 500 ) ? 'ok' : 'fail';
	}
	set_transient( 'brc_test_result_' . get_current_user_id(), $result, 60 );
	wp_safe_redirect( add_query_arg( array( 'page' => 'brandrep-connector', 'brc_notice' => 'tested' ), admin_url( 'admin.php' ) ) );
	exit;
}

function brc_render_settings_page() {
	if ( ! current_user_can( 'manage_woocommerce' ) ) {
		wp_die( esc_html__( 'Not allowed.', 'brandrep-connector' ) );
	}
	$s      = brc_settings();
	$notice = isset( $_GET['brc_notice'] ) ? sanitize_text_field( wp_unslash( $_GET['brc_notice'] ) ) : '';
	$test   = get_transient( 'brc_test_result_' . get_current_user_id() );
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'BrandRep Connector', 'brandrep-connector' ); ?></h1>

		<?php if ( 'saved' === $notice ) : ?>
			<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Settings saved.', 'brandrep-connector' ); ?></p></div>
		<?php endif; ?>
		<?php if ( 'tested' === $notice ) : ?>
			<?php if ( 'ok' === $test ) : ?>
				<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Hub is reachable. This only checks reachability — no referral data was sent.', 'brandrep-connector' ); ?></p></div>
			<?php else : ?>
				<div class="notice notice-error is-dismissible"><p><?php esc_html_e( 'Hub could not be reached. Check the hub URL and that the hub site is online.', 'brandrep-connector' ); ?></p></div>
			<?php endif; ?>
		<?php endif; ?>

		<?php if ( $s['enabled'] && ! brc_is_configured() ) : ?>
			<div class="notice notice-warning"><p>
				<?php esc_html_e( 'BrandRep is enabled but not fully configured: the bridge secret must be 32–256 characters and the hub URL must be valid. Until then the connector does nothing on the storefront.', 'brandrep-connector' ); ?>
			</p></div>
		<?php endif; ?>
		<?php if ( ! $s['enabled'] ) : ?>
			<div class="notice notice-info"><p><?php esc_html_e( 'BrandRep is currently disabled. Nothing is tracked and no data is sent while disabled.', 'brandrep-connector' ); ?></p></div>
		<?php endif; ?>

		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="brc_save_settings" />
			<?php wp_nonce_field( 'brc_save_settings' ); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><?php esc_html_e( 'Enable connector', 'brandrep-connector' ); ?></th>
					<td>
						<label>
							<input type="checkbox" name="brc_enabled" value="1" <?php checked( $s['enabled'], 1 ); ?> />
							<?php esc_html_e( 'Capture referrals and associate orders with the BrandRep hub', 'brandrep-connector' ); ?>
						</label>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="brc_hub_url"><?php esc_html_e( 'Hub URL', 'brandrep-connector' ); ?></label></th>
					<td>
						<input type="url" class="regular-text" id="brc_hub_url" name="brc_hub_url" value="<?php echo esc_attr( $s['hub_url'] ); ?>" />
						<p class="description"><?php esc_html_e( 'The BrandRep hub base URL, without a trailing path.', 'brandrep-connector' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="brc_bridge_secret"><?php esc_html_e( 'Bridge secret', 'brandrep-connector' ); ?></label></th>
					<td>
						<input type="password" class="regular-text" id="brc_bridge_secret" name="brc_bridge_secret" value="" autocomplete="new-password" placeholder="<?php echo esc_attr( '' !== $s['bridge_secret'] ? '•••••••• (saved — leave blank to keep)' : '' ); ?>" />
						<p class="description">
							<?php esc_html_e( 'Must match REFERRAL_BRIDGE_SECRET on the hub (32–256 characters). Stored only in this site\'s options; never shown again or sent anywhere except as an HMAC signature.', 'brandrep-connector' ); ?>
							<?php if ( '' !== $s['bridge_secret'] ) : ?>
								<?php esc_html_e( 'A secret is currently saved.', 'brandrep-connector' ); ?>
							<?php endif; ?>
						</p>
					</td>
				</tr>
			</table>
			<?php submit_button( __( 'Save settings', 'brandrep-connector' ) ); ?>
		</form>

		<hr />
		<h2><?php esc_html_e( 'Test connection', 'brandrep-connector' ); ?></h2>
		<p><?php esc_html_e( 'Checks that the hub site responds. This never sends referral or order data.', 'brandrep-connector' ); ?></p>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="brc_test_connection" />
			<?php wp_nonce_field( 'brc_test_connection' ); ?>
			<?php submit_button( __( 'Test hub reachability', 'brandrep-connector' ), 'secondary' ); ?>
		</form>
	</div>
	<?php
}

/* -------------------------------------------------------------------------
 * My Account: "BrandRep" endpoint — account linking
 *
 * The customer copies two values from their BrandRep dashboard:
 *   1. their link token (format: brlink_<64 hex characters>)
 *   2. their BrandRep User ID (a UUID, shown next to the token)
 * Both are stored in usermeta. The token itself is a credential: it is
 * only ever sent to the hub as the Authorization bearer on order events,
 * and is displayed masked (last 4 characters only).
 * ---------------------------------------------------------------------- */
add_action( 'init', 'brc_register_account_endpoint' );
function brc_register_account_endpoint() {
	add_rewrite_endpoint( 'brandrep', EP_ROOT | EP_PAGES );
}

add_filter( 'woocommerce_account_menu_items', 'brc_account_menu_item' );
function brc_account_menu_item( $items ) {
	$new = array();
	foreach ( $items as $key => $label ) {
		$new[ $key ] = $label;
		if ( 'dashboard' === $key ) {
			$new['brandrep'] = __( 'BrandRep', 'brandrep-connector' );
		}
	}
	if ( ! isset( $new['brandrep'] ) ) {
		$new['brandrep'] = __( 'BrandRep', 'brandrep-connector' );
	}
	return $new;
}

function brc_link_token_valid( $token ) {
	return is_string( $token ) && 1 === preg_match( '/^brlink_[a-f0-9]{64}$/', $token );
}

function brc_user_id_valid( $uuid ) {
	return is_string( $uuid ) && 1 === preg_match( '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $uuid );
}

add_action( 'template_redirect', 'brc_handle_account_linking', 5 );
function brc_handle_account_linking() {
	if ( ! is_user_logged_in() || ! is_account_page() ) {
		return;
	}
	global $wp_query;
	if ( ! isset( $wp_query->query_vars['brandrep'] ) ) {
		return;
	}
	if ( ! isset( $_POST['brc_link_action'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Missing
		return;
	}
	if ( ! isset( $_POST['brc_link_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['brc_link_nonce'] ) ), 'brc_link_account' ) ) {
		return;
	}

	$user_id = get_current_user_id();
	$action  = sanitize_text_field( wp_unslash( $_POST['brc_link_action'] ) );
	$notice  = 'error';

	if ( 'unlink' === $action ) {
		delete_user_meta( $user_id, '_brandrep_link_token' );
		delete_user_meta( $user_id, '_brandrep_user_id' );
		$notice = 'unlinked';
	} elseif ( 'link' === $action ) {
		$token = isset( $_POST['brc_link_token'] ) ? trim( sanitize_text_field( wp_unslash( $_POST['brc_link_token'] ) ) ) : '';
		// Accept the bare 64-hex value too and normalise it to the full token.
		if ( 1 === preg_match( '/^[a-f0-9]{64}$/', $token ) ) {
			$token = 'brlink_' . $token;
		}
		$brandrep_user_id = isset( $_POST['brc_user_id'] ) ? strtolower( trim( sanitize_text_field( wp_unslash( $_POST['brc_user_id'] ) ) ) ) : '';
		if ( brc_link_token_valid( $token ) && brc_user_id_valid( $brandrep_user_id ) ) {
			update_user_meta( $user_id, '_brandrep_link_token', $token );
			update_user_meta( $user_id, '_brandrep_user_id', $brandrep_user_id );
			$notice = 'linked';
		}
	}

	wp_safe_redirect( add_query_arg( 'brc_notice', $notice, wc_get_account_endpoint_url( 'brandrep' ) ) );
	exit;
}

add_action( 'woocommerce_account_brandrep_endpoint', 'brc_render_account_endpoint' );
function brc_render_account_endpoint() {
	$user_id = get_current_user_id();
	$token   = (string) get_user_meta( $user_id, '_brandrep_link_token', true );
	$buid    = (string) get_user_meta( $user_id, '_brandrep_user_id', true );
	$notice  = isset( $_GET['brc_notice'] ) ? sanitize_text_field( wp_unslash( $_GET['brc_notice'] ) ) : '';

	if ( 'linked' === $notice ) {
		wc_print_notice( __( 'Your BrandRep account is linked.', 'brandrep-connector' ), 'success' );
	} elseif ( 'unlinked' === $notice ) {
		wc_print_notice( __( 'Your BrandRep account has been unlinked.', 'brandrep-connector' ), 'success' );
	} elseif ( 'error' === $notice ) {
		wc_print_notice( __( 'That link token or BrandRep User ID did not look right. Check both values and try again.', 'brandrep-connector' ), 'error' );
	}

	if ( brc_link_token_valid( $token ) && brc_user_id_valid( $buid ) ) :
		?>
		<h3><?php esc_html_e( 'BrandRep account linked', 'brandrep-connector' ); ?></h3>
		<p>
			<?php
			printf(
				/* translators: %1$s masked token ending, %2$s BrandRep user ID */
				esc_html__( 'Link token: ••••%1$s · BrandRep User ID: %2$s', 'brandrep-connector' ),
				esc_html( substr( $token, -4 ) ),
				esc_html( $buid )
			);
			?>
		</p>
		<p><?php esc_html_e( 'Orders you place while signed in can now be credited through BrandRep when you arrived via a partner link — referral tracking activates automatically when the link is clicked, with no popup to accept.', 'brandrep-connector' ); ?></p>
		<form method="post">
			<?php wp_nonce_field( 'brc_link_account', 'brc_link_nonce' ); ?>
			<input type="hidden" name="brc_link_action" value="unlink" />
			<button type="submit" class="button"><?php esc_html_e( 'Unlink BrandRep account', 'brandrep-connector' ); ?></button>
		</form>
		<?php
	else :
		?>
		<h3><?php esc_html_e( 'Link your BrandRep account', 'brandrep-connector' ); ?></h3>
		<p><?php esc_html_e( 'If you buy through a partner\'s referral link and want the purchase tracked under your own BrandRep identity (for example to prevent self-referral mistakes), link your accounts here.', 'brandrep-connector' ); ?></p>
		<p><strong><?php esc_html_e( 'You need two values from your BrandRep dashboard:', 'brandrep-connector' ); ?></strong></p>
		<ol>
			<li><?php esc_html_e( 'Your link token — it starts with "brlink_". Paste the whole token.', 'brandrep-connector' ); ?></li>
			<li><?php esc_html_e( 'Your BrandRep User ID — the code shown right next to the token on the dashboard. Paste it exactly.', 'brandrep-connector' ); ?></li>
		</ol>
		<form method="post">
			<?php wp_nonce_field( 'brc_link_account', 'brc_link_nonce' ); ?>
			<input type="hidden" name="brc_link_action" value="link" />
			<p class="woocommerce-form-row form-row form-row-wide">
				<label for="brc_link_token"><?php esc_html_e( 'Link token', 'brandrep-connector' ); ?> <span class="required">*</span></label>
				<input type="text" class="input-text" name="brc_link_token" id="brc_link_token" autocomplete="off" />
			</p>
			<p class="woocommerce-form-row form-row form-row-wide">
				<label for="brc_user_id"><?php esc_html_e( 'BrandRep User ID', 'brandrep-connector' ); ?> <span class="required">*</span></label>
				<input type="text" class="input-text" name="brc_user_id" id="brc_user_id" autocomplete="off" />
			</p>
			<button type="submit" class="button"><?php esc_html_e( 'Link account', 'brandrep-connector' ); ?></button>
		</form>
		<?php
	endif;
}

/* -------------------------------------------------------------------------
 * Order association
 *
 * Meta snapshot at checkout creation (HPOS-safe: the order object is
 * passed in and persisted through WooCommerce CRUD — no direct table
 * writes), then a signed "order" bridge event once the order is paid
 * (payment complete, or status processing/completed).
 *
 * One request ID is generated per order and reused across every retry
 * with an identical body, so the hub can deduplicate safely.
 * ---------------------------------------------------------------------- */
add_action( 'woocommerce_checkout_create_order', 'brc_snapshot_order_meta', 20, 1 );
add_action( 'woocommerce_checkout_order_created', 'brc_snapshot_order_meta_by_id', 20, 1 );
function brc_snapshot_order_meta( $order ) {
	if ( ! $order instanceof WC_Order ) {
		return;
	}
	if ( '' !== (string) $order->get_meta( '_brandrep_visitor_hash' ) ) {
		return; // Already snapshotted.
	}
	$visitor_hash = brc_visitor_hash();
	if ( '' === $visitor_hash ) {
		return; // Visitor never arrived via a referral link.
	}
	$order->update_meta_data( '_brandrep_visitor_hash', $visitor_hash );
	$consent = isset( $_COOKIE['br_consent'] ) ? sanitize_text_field( wp_unslash( $_COOKIE['br_consent'] ) ) : '';
	$order->update_meta_data( '_brandrep_consent', 'yes' === $consent ? 'yes' : 'no' );

	// Snapshot the linked BrandRep user ID (not the token — the token is a
	// credential and is read live from usermeta when the event is sent).
	$user_id = $order->get_user_id();
	if ( $user_id ) {
		$buid = (string) get_user_meta( $user_id, '_brandrep_user_id', true );
		if ( brc_user_id_valid( $buid ) ) {
			$order->update_meta_data( '_brandrep_buyer_user_id', $buid );
		}
	}
	// Note: with woocommerce_checkout_create_order the order is saved by
	// WooCommerce right after this hook; the by-id fallback below covers
	// flows where the object is not persisted again.
}

function brc_snapshot_order_meta_by_id( $order_id ) {
	$order = wc_get_order( $order_id );
	if ( ! $order ) {
		return;
	}
	$before = (string) $order->get_meta( '_brandrep_visitor_hash' );
	brc_snapshot_order_meta( $order );
	if ( '' === $before && '' !== (string) $order->get_meta( '_brandrep_visitor_hash' ) ) {
		$order->save();
	}
}

add_action( 'woocommerce_payment_complete', 'brc_maybe_associate_order', 20, 1 );
add_action( 'woocommerce_order_status_processing', 'brc_maybe_associate_order', 20, 1 );
add_action( 'woocommerce_order_status_completed', 'brc_maybe_associate_order', 20, 1 );
add_action( 'brandrep_retry_assoc', 'brc_maybe_associate_order', 10, 1 );

function brc_maybe_associate_order( $order_id ) {
	$order_id = absint( $order_id );
	if ( ! $order_id || ! brc_is_configured() ) {
		return false;
	}
	$order = wc_get_order( $order_id );
	if ( ! $order ) {
		return false;
	}
	if ( (string) $order->get_meta( '_brandrep_assoc_sent' ) === '1' ) {
		return true; // Already associated.
	}
	if ( 'yes' !== (string) $order->get_meta( '_brandrep_consent' ) ) {
		return false; // No consent: never associate.
	}
	$visitor_hash = (string) $order->get_meta( '_brandrep_visitor_hash' );
	if ( '' === $visitor_hash ) {
		return false;
	}

	$user_id = $order->get_user_id();
	if ( ! $user_id ) {
		return false; // Guest order: cannot be associated.
	}
	$token = (string) get_user_meta( $user_id, '_brandrep_link_token', true );
	$buid  = (string) $order->get_meta( '_brandrep_buyer_user_id' );
	if ( '' === $buid ) {
		$buid = (string) get_user_meta( $user_id, '_brandrep_user_id', true );
	}
	if ( ! brc_link_token_valid( $token ) || ! brc_user_id_valid( $buid ) ) {
		return false; // Buyer not linked.
	}

	// One stable request ID per order event, reused on every retry.
	$request_id = (string) $order->get_meta( '_brandrep_assoc_reqid' );
	if ( ! brc_user_id_valid( $request_id ) ) {
		$request_id = wp_generate_uuid4();
		$order->update_meta_data( '_brandrep_assoc_reqid', $request_id );
		$order->save();
	}

	$created = $order->get_date_created();
	if ( ! $created ) {
		return false;
	}
	// orderAt: the store-verified creation time, GMT, with milliseconds.
	$order_at = gmdate( 'Y-m-d\TH:i:s', $created->getTimestamp() ) . '.000Z';

	// Key order matches the bridge contract exactly; no extra keys.
	$body = array(
		'kind'        => 'order',
		'visitorHash' => $visitor_hash,
		'orderId'     => (string) $order_id,
		'orderAt'     => $order_at,
		'buyerUserId' => $buid,
	);

	$response = brc_bridge_post( $body, $request_id, $token );

	if ( brc_bridge_accepted( $response ) ) {
		$order->update_meta_data( '_brandrep_assoc_sent', '1' );
		$order->update_meta_data( '_brandrep_assoc_sent_at', gmdate( 'Y-m-d\TH:i:s\Z' ) );
		$order->save();
		return true;
	}

	// Failure: bounded retries with backoff through WP-Cron.
	$attempts = absint( $order->get_meta( '_brandrep_assoc_attempts' ) ) + 1;
	$order->update_meta_data( '_brandrep_assoc_attempts', $attempts );
	$order->save();

	$backoff = array( 15 * MINUTE_IN_SECONDS, HOUR_IN_SECONDS, 6 * HOUR_IN_SECONDS );
	if ( $attempts <= count( $backoff ) ) {
		if ( ! wp_next_scheduled( 'brandrep_retry_assoc', array( $order_id ) ) ) {
			wp_schedule_single_event( time() + $backoff[ $attempts - 1 ], 'brandrep_retry_assoc', array( $order_id ) );
		}
	}
	return false;
}
