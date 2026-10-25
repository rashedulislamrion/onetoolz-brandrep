/**
 * BrandRep Connector — consent banner enhancement.
 * Progressive enhancement only: the banner buttons are plain links that
 * work without JavaScript (handled server-side). With JS, the choice is
 * recorded via AJAX and the banner closes without a page reload.
 */
(function () {
	'use strict';

	var banner = document.getElementById('brc-banner');
	if (!banner || typeof window.BrandRepBanner === 'undefined') {
		return;
	}

	banner.addEventListener('click', function (event) {
		var link = event.target.closest('[data-brc-choice]');
		if (!link) {
			return;
		}
		event.preventDefault();

		var choice = link.getAttribute('data-brc-choice');
		var body = new URLSearchParams();
		body.set('action', 'brc_consent');
		body.set('nonce', window.BrandRepBanner.nonce);
		body.set('choice', choice);

		fetch(window.BrandRepBanner.ajaxUrl, {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
			body: body.toString()
		})
			.then(function () {
				banner.remove();
			})
			.catch(function () {
				// Fall back to the plain link if the request fails.
				window.location.href = link.href;
			});
	});
})();
