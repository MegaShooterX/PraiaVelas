// Where the app keeps what it wants to remember: the quotes already downloaded, the list of funds, the simulated
// broker. In the app that is the browser's localStorage; the terminal tools hand in a folder on disk instead.
// Losing the cache is never a problem (it comes back from the internet); the list and the broker are kept apart
// from it so that clearing room never touches them.

const memory = new Map();
let custom = null;

/** Lets a caller (the terminal tools) keep things somewhere else: an object with get(key) and set(key, text). */
export function useStore(store) {
	custom = store;
}

function browserStorage() {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

function readRaw(key) {
	if (custom) return custom.get(key);
	const storage = browserStorage();
	return storage ? storage.getItem(key) : (memory.get(key) ?? null);
}

function writeRaw(key, raw) {
	if (custom) return custom.set(key, raw);
	const storage = browserStorage();
	if (!storage) return memory.set(key, raw);
	try {
		storage.setItem(key, raw);
	} catch {
		// Full: what can go is the cache, never the list or the broker.
		for (let i = storage.length - 1; i >= 0; i--) {
			const k = storage.key(i);
			if (k?.startsWith('cache:') && k !== key) storage.removeItem(k);
		}
		try {
			storage.setItem(key, raw);
		} catch {
			memory.set(key, raw);
		}
	}
}

export function load(key, fallback = null) {
	try {
		const raw = readRaw(key);
		return raw == null ? fallback : JSON.parse(raw);
	} catch {
		return fallback;
	}
}

export function save(key, value) {
	writeRaw(key, JSON.stringify(value));
}
