// The app's service worker: what lets a phone's browser install the site as an app, with its icon on the home
// screen (manifest.webmanifest). It keeps nothing: every page and every piece of data still comes fresh from the
// network, so the robot never shows a day that is not the last one. Not used inside the Android app (APK).

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
	if (event.request.mode !== 'navigate') return;
	event.respondWith(
		fetch(event.request).catch(
			() =>
				new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="background:#0b1220;color:#e6edf7;font:15px system-ui;padding:16px">O PraiaVelas não respondeu: sem internet agora (ou, no computador, o programa do app foi fechado). <a href="" style="color:#38bdf8">Tentar de novo</a></body>', {
					headers: { 'content-type': 'text/html; charset=utf-8' }
				})
		)
	);
});
