// The app's service worker: what lets a phone's browser install the site as an app, with its icon on the home
// screen (manifest.webmanifest). It keeps nothing: every page and every piece of data still comes fresh from the
// network, so the robot never shows a day that is not the last one. Not used inside the Android app (APK).
//
// The app's own code (pages, scripts, styles) is always checked against the server (cache: 'no-cache': a quick "has
// it changed?"), so a new version reaches the installed app at once, not after GitHub's 10 minutes of cache
// (10/11/2026: the screen showed the old list right after an update).

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const OFFLINE =
	'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="background:#0b1220;color:#e6edf7;font:15px system-ui;padding:16px">O PraiaVelas não respondeu: sem internet agora (ou, no computador, o programa do app foi fechado). <a href="" style="color:#38bdf8">Tentar de novo</a></body>';

self.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;
	if (request.mode === 'navigate') {
		event.respondWith(fetch(request, { cache: 'no-cache' }).catch(() => new Response(OFFLINE, { headers: { 'content-type': 'text/html; charset=utf-8' } })));
		return;
	}
	const url = new URL(request.url);
	if (url.origin === location.origin && /\.(js|css|webmanifest)$/.test(url.pathname)) event.respondWith(fetch(request, { cache: 'no-cache' }));
});
