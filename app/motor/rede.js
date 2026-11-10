// One way to download text from the internet, wherever the app is running:
// - in the Android app, through the phone's own HTTP (Capacitor), which the browser's CORS rule does not bind:
//   Yahoo and Google News do not let a web page read them directly;
// - in a browser on the computer, through the small proxy of ferramentas/servidor.mjs, for the same reason;
// - in Node (the tests and the terminal tool), straight.

// Yahoo answers "too many requests" (429) to a phone's browser name (tested 08/11/2026), and takes a desktop one.
const BROWSER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

/** The only places the app reads from. The proxy refuses any other, so it cannot be used to reach anything else. */
export const ALLOWED_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com', 'news.google.com', 'api.bcb.gov.br', 'dados.cvm.gov.br'];

export function isNativeApp() {
	return Boolean(globalThis.Capacitor?.isNativePlatform?.());
}

function nativeHttp() {
	return isNativeApp() ? (globalThis.Capacitor.Plugins?.CapacitorHttp ?? null) : null;
}

async function withTimeout(url, init, timeoutMs) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, { ...init, signal: controller.signal });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return await response.text();
	} catch (error) {
		if (error.name === 'AbortError') throw new Error('sem resposta (tempo esgotado)');
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

export async function getText(url, { timeoutMs = 20000 } = {}) {
	const http = nativeHttp();
	if (http) {
		try {
			const res = await http.request({
				url,
				method: 'GET',
				headers: { 'User-Agent': BROWSER_AGENT, Accept: '*/*' },
				responseType: 'text',
				connectTimeout: timeoutMs,
				readTimeout: timeoutMs
			});
			if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
			// Android hands JSON back already read, whatever was asked for.
			return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
		} catch (error) {
			if (/HTTP \d/.test(String(error.message))) throw error;
			// The plugin missing or failing: with CapacitorHttp on, the app's fetch also goes through the phone.
			return withTimeout(url, {}, timeoutMs);
		}
	}
	if (typeof window === 'undefined') return withTimeout(url, { headers: { 'user-agent': BROWSER_AGENT } }, timeoutMs);
	return withTimeout(`/proxy?u=${encodeURIComponent(url)}`, {}, timeoutMs);
}

async function bytesWithTimeout(url, init, timeoutMs) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, { ...init, signal: controller.signal });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return new Uint8Array(await response.arrayBuffer());
	} catch (error) {
		if (error.name === 'AbortError') throw new Error('sem resposta (tempo esgotado)');
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

/** Base64 (the phone's plugin hands binary data back this way, with line breaks) → bytes. */
function fromBase64(text) {
	const bin = atob(String(text).replace(/\s+/g, ''));
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

/** A file as bytes (the CVM's zips, since 0.0.5), by the same three ways as getText. */
export async function getBytes(url, { timeoutMs = 60000 } = {}) {
	const http = nativeHttp();
	if (http) {
		try {
			const res = await http.request({
				url,
				method: 'GET',
				headers: { 'User-Agent': BROWSER_AGENT, Accept: '*/*' },
				responseType: 'arraybuffer',
				connectTimeout: timeoutMs,
				readTimeout: timeoutMs
			});
			if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
			if (res.data instanceof ArrayBuffer) return new Uint8Array(res.data);
			return fromBase64(res.data);
		} catch (error) {
			if (/HTTP \d/.test(String(error.message))) throw error;
			return bytesWithTimeout(url, {}, timeoutMs);
		}
	}
	if (typeof window === 'undefined') return bytesWithTimeout(url, { headers: { 'user-agent': BROWSER_AGENT } }, timeoutMs);
	return bytesWithTimeout(`/proxy?u=${encodeURIComponent(url)}`, {}, timeoutMs);
}

export async function getJson(url, options) {
	return JSON.parse(await getText(url, options));
}
