// The site on GitHub Pages (megashooterx.github.io/PraiaVelas, since 09/11/2026).
//
// There is no proxy there (the computer's ferramentas/servidor.mjs), and Yahoo and the CVM do not let a page of
// another site read them. So a job of GitHub (.github/workflows/site.yml, running ferramentas/site.mjs) downloads,
// every weekday after the B3 closes, everything the app asks for when it opens, and publishes it with the page in
// dados/. Here, on the site only, the page's requests to the proxy are answered from those files.
//
// It lives outside motor/ on purpose: the engine stays the same code (and the same hash) everywhere, so the weekly
// sealed decisions keep counting for the same engine. On the computer and on the phone nothing here runs.

/** Seen as the site: GitHub Pages, or "?estatico" in the address (to try the built site on the computer). */
export const ONLINE =
	typeof location !== 'undefined' &&
	typeof window !== 'undefined' &&
	!globalThis.Capacitor?.isNativePlatform?.() &&
	(/\.github\.io$/.test(location.hostname) || new URLSearchParams(location.search).has('estatico'));

/**
 * The file in dados/ of one address: the same for the job that writes it and the page that reads it. Yahoo's two
 * doors (query1, query2) are the same data, so they share it. ".json" lets GitHub send it compressed.
 */
export function snapshotName(url) {
	const u = String(url).replace(/^https?:\/\//, '').replace(/^query2\./, 'query1.');
	let h = 2166136261;
	for (let i = 0; i < u.length; i++) {
		h ^= u.charCodeAt(i);
		h = Math.imul(h, 16777619) >>> 0;
	}
	const readable = u.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 60);
	return `${readable}_${h.toString(16).padStart(8, '0')}${/\.zip(\?|$)/.test(u) ? '.zip' : '.json'}`;
}

if (ONLINE) {
	const real = window.fetch.bind(window);
	window.fetch = (input, init) => {
		const asked = typeof input === 'string' ? input : (input?.url ?? '');
		const proxied = /^\/proxy\?u=(.*)$/.exec(asked);
		if (!proxied) return real(input, init);
		const target = decodeURIComponent(proxied[1]);
		// The Banco Central lets any site read it: straight there.
		if (/^https:\/\/api\.bcb\.gov\.br\//.test(target)) return real(target, init);
		return real(new URL(`dados/${snapshotName(target)}`, document.baseURI).href, init);
	};
}

/** When the site's data was downloaded, and up to which close (dados/sobre.json); null off the site. */
export async function siteInfo() {
	if (!ONLINE) return null;
	try {
		const r = await fetch(new URL('dados/sobre.json', document.baseURI).href, { cache: 'no-store' });
		return r.ok ? await r.json() : null;
	} catch {
		return null;
	}
}

/** An error of the site in a person's words: only the robot's assets have data there. */
export function explainOnline(message) {
	if (!ONLINE || !/não encontrado|HTTP 404/.test(String(message))) return message;
	// The engine says "não encontrado no Yahoo Finance", which is not true here: it is only not in the site's data.
	const ticker = /^(\S+) não encontrado/.exec(String(message))?.[1] ?? 'Este código';
	return `${ticker} não está no site: aqui só aparecem os 63 ativos que o robô estuda. No app do celular dá para buscar qualquer código.`;
}
