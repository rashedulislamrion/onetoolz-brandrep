<?php
/**
 * BrandRep Connector — uninstall cleanup.
 *
 * Removes the plugin's settings and the per-user linking data it stored.
 * Order meta is intentionally NOT deleted: _brandrep_* order fields are
 * the store-side evidence that an association was (or was not) sent for
 * an order, and deleting them would destroy that audit trail. Remove them
 * manually from the database if a full purge is ever required — see the
 * "Uninstall cleanup" section of woo-connector/README.md.
 *
 * @package BrandRepConnector
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

// Plugin settings (hub URL, bridge secret, enable flag).
delete_option( 'brandrep_connector_settings' );

// Per-user BrandRep linking data.
delete_metadata( 'user', 0, '_brandrep_link_token', '', true );
delete_metadata( 'user', 0, '_brandrep_user_id', '', true );

// Scheduled retry events that have not fired yet.
$brandrep_retries = _get_cron_array();
if ( is_array( $brandrep_retries ) ) {
	foreach ( $brandrep_retries as $brandrep_timestamp => $brandrep_hooks ) {
		if ( isset( $brandrep_hooks['brandrep_retry_assoc'] ) ) {
			foreach ( $brandrep_hooks['brandrep_retry_assoc'] as $brandrep_key => $brandrep_event ) {
				wp_unschedule_event( $brandrep_timestamp, 'brandrep_retry_assoc', $brandrep_event['args'] );
			}
		}
	}
}
