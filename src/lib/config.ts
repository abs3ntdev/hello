import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveIcon } from "./icons";

export interface Tab {
	/** Unique stable id. Used in DOM ids and URL hash. */
	id: string;
	/** Display name shown in title + tooltip. */
	name: string;
	/** URL to load in the iframe. */
	url: string;
	/**
	 * Icon. One of:
	 *   - an emoji / single character              "📺"
	 *   - an absolute URL to an image              "https://.../logo.png"
	 *   - a path served by this app                "/icons/plex.svg"
	 *   - a selfh.st/icons shorthand:
	 *       homepage/dashy compatible              "sh-plex"
	 *                                              "sh-plex.png"
	 *                                              "sh-plex-light.webp"
	 *       explicit form (supports /variant)      "selfhst:plex"
	 *                                              "selfhst:plex/light"
	 *                                              "selfhst:plex/dark"
	 *                                              "selfhst:plex.png"
	 *                                              "selfhst:plex/dark.webp"
	 *
	 * Default format for selfh.st icons is SVG (falls back per-icon to
	 * whatever the repo ships). Supported formats: svg, png, webp, avif, ico.
	 */
	icon: string;
	/** If true, iframe is created at boot and kept alive in background. */
	preload?: boolean;
	/** Optional iframe sandbox attribute (space-separated). */
	sandbox?: string;
	/** Optional iframe allow attribute. */
	allow?: string;
	/**
	 * Optional group label. Tabs sharing a group render together in the
	 * sidebar with a thin divider between groups. Group order defaults to the
	 * order each label is first seen, or use the top-level `groupOrder`
	 * config field to pin it explicitly. Ungrouped tabs always render first.
	 */
	group?: string;
	/**
	 * Health-check target. One of:
	 *   - omitted          : no health check for this tab
	 *   - `true`           : ping the tab's main `url`
	 *   - a URL string     : ping that URL instead of `url` (useful when your
	 *                        public iframe URL is behind auth but you want to
	 *                        probe an internal `http://host:port` directly)
	 *
	 * Checks are performed server-side (via GET /api/ping?id=<tab.id>) so
	 * they work across CORS, private networks, and HTTP/HTTPS boundaries.
	 */
	ping?: boolean | string;
}

export interface AppConfig {
	/** Page title / brand text in the sidebar. */
	title: string;
	/** Tab to open on first load. Defaults to the first tab. */
	defaultTab?: string;
	/**
	 * Explicit group order. Any group listed here renders in this order;
	 * groups not listed fall back to first-occurrence order after the listed
	 * ones. Ungrouped tabs always come first regardless.
	 */
	groupOrder?: string[];
	tabs: Tab[];
}

const CONFIG_PATH =
	process.env.HELLO_CONFIG ?? resolve(process.cwd(), "config", "config.json");

const FALLBACK: AppConfig = {
	title: "hello",
	tabs: [
		{
			id: "example",
			name: "Example",
			url: "https://example.com",
			icon: "🌐",
		},
	],
};

function validate(raw: unknown): AppConfig {
	if (!raw || typeof raw !== "object") {
		throw new Error("config.json: root must be an object");
	}
	const c = raw as Record<string, unknown>;
	if (!Array.isArray(c.tabs)) {
		throw new Error("config.json: 'tabs' must be an array");
	}
	const seen = new Set<string>();
	const tabs: Tab[] = c.tabs.map((t, i) => {
		if (!t || typeof t !== "object") {
			throw new Error(`config.json: tabs[${i}] must be an object`);
		}
		const tab = t as Record<string, unknown>;
		for (const key of ["id", "name", "url", "icon"] as const) {
			if (typeof tab[key] !== "string" || !(tab[key] as string).length) {
				throw new Error(
					`config.json: tabs[${i}].${key} must be a non-empty string`,
				);
			}
		}
		// Validate URL shape so typos fail fast instead of producing a blank
		// iframe with no console error.
		try {
			new URL(tab.url as string);
		} catch {
			throw new Error(
				`config.json: tabs[${i}].url "${tab.url as string}" is not a valid URL`,
			);
		}
		// Validate icon syntax now so typos fail fast on page refresh.
		try {
			resolveIcon(tab.icon as string);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			throw new Error(`config.json: tabs[${i}].${msg}`);
		}
		if (tab.group !== undefined && typeof tab.group !== "string") {
			throw new Error(
				`config.json: tabs[${i}].group must be a string when present`,
			);
		}
		// ping: boolean | URL string. Reject anything else up front so typos
		// don't silently disable health checks.
		if (tab.ping !== undefined) {
			if (typeof tab.ping === "string") {
				try {
					new URL(tab.ping);
				} catch {
					throw new Error(
						`config.json: tabs[${i}].ping "${tab.ping}" is not a valid URL`,
					);
				}
			} else if (typeof tab.ping !== "boolean") {
				throw new Error(
					`config.json: tabs[${i}].ping must be a boolean or URL string`,
				);
			}
		}
		const id = tab.id as string;
		if (!/^[A-Za-z0-9_-]+$/.test(id)) {
			throw new Error(
				`config.json: tabs[${i}].id "${id}" must match /^[A-Za-z0-9_-]+$/`,
			);
		}
		if (seen.has(id)) {
			throw new Error(`config.json: duplicate tab id "${id}"`);
		}
		seen.add(id);
		return {
			id,
			name: tab.name as string,
			url: tab.url as string,
			icon: tab.icon as string,
			preload: typeof tab.preload === "boolean" ? tab.preload : undefined,
			sandbox: typeof tab.sandbox === "string" ? tab.sandbox : undefined,
			allow: typeof tab.allow === "string" ? tab.allow : undefined,
			group:
				typeof tab.group === "string" && tab.group.length
					? tab.group
					: undefined,
			ping:
				typeof tab.ping === "boolean" || typeof tab.ping === "string"
					? (tab.ping as boolean | string)
					: undefined,
		};
	});
	if (tabs.length === 0) {
		throw new Error("config.json: at least one tab is required");
	}
	const defaultTab =
		typeof c.defaultTab === "string" ? c.defaultTab : undefined;
	if (defaultTab && !seen.has(defaultTab)) {
		throw new Error(
			`config.json: defaultTab "${defaultTab}" does not match any tab id`,
		);
	}
	let groupOrder: string[] | undefined;
	if (c.groupOrder !== undefined) {
		if (!Array.isArray(c.groupOrder)) {
			throw new Error("config.json: groupOrder must be an array of strings");
		}
		groupOrder = c.groupOrder.map((g, i) => {
			if (typeof g !== "string" || !g.length) {
				throw new Error(
					`config.json: groupOrder[${i}] must be a non-empty string`,
				);
			}
			return g;
		});
	}
	return {
		title: typeof c.title === "string" && c.title ? c.title : "hello",
		defaultTab,
		groupOrder,
		tabs,
	};
}

/**
 * Bucket tabs into ordered groups for rendering.
 *
 * Ordering rules:
 *   1. Ungrouped tabs (no `group` field) always render first as a single
 *      anonymous bucket at the top of the sidebar.
 *   2. Groups named in `groupOrder` render next, in the order listed. Groups
 *      listed but with no tabs are silently dropped.
 *   3. Remaining groups (present in tabs, missing from `groupOrder`) render
 *      last in first-occurrence order — the historical default.
 *   4. Within each bucket, tab order matches config order.
 */
export function groupTabs(
	tabs: Tab[],
	groupOrder?: readonly string[],
): Array<{ label: string | null; tabs: Tab[] }> {
	const buckets = new Map<string | null, Tab[]>();
	const firstSeen: Array<string | null> = [];
	for (const tab of tabs) {
		const key = tab.group ?? null;
		if (!buckets.has(key)) {
			buckets.set(key, []);
			firstSeen.push(key);
		}
		buckets.get(key)!.push(tab);
	}

	const out: Array<{ label: string | null; tabs: Tab[] }> = [];
	const used = new Set<string | null>();

	// 1. Ungrouped first.
	if (buckets.has(null)) {
		out.push({ label: null, tabs: buckets.get(null)! });
		used.add(null);
	}

	// 2. Explicit order.
	if (groupOrder) {
		for (const label of groupOrder) {
			if (!used.has(label) && buckets.has(label)) {
				out.push({ label, tabs: buckets.get(label)! });
				used.add(label);
			}
		}
	}

	// 3. Anything left, in first-occurrence order.
	for (const label of firstSeen) {
		if (!used.has(label)) {
			out.push({ label, tabs: buckets.get(label)! });
			used.add(label);
		}
	}

	return out;
}

/**
 * In-memory cache for the parsed config, keyed by mtime.
 *
 * Before this, loadConfig() read + JSON.parse'd the file on every request.
 * That's fine at homelab scale, but caching against the file's mtime gives
 * us a true zero-I/O hit on steady state while still picking up host edits
 * within one stat() call — no live-reload coordination required.
 */
interface Cached {
	mtimeMs: number;
	config: AppConfig;
}
let cache: Cached | undefined;

/**
 * Read and validate the config, honoring a single-entry mtime cache so
 * repeat requests don't touch the filesystem beyond a stat().
 *
 * Edits to the mounted config.json take effect immediately on the next
 * request — the stat() mtime changes on any write.
 */
export async function loadConfig(): Promise<AppConfig> {
	try {
		const st = await stat(CONFIG_PATH);
		if (cache && cache.mtimeMs === st.mtimeMs) {
			return cache.config;
		}
		const txt = await readFile(CONFIG_PATH, "utf8");
		const config = validate(JSON.parse(txt));
		cache = { mtimeMs: st.mtimeMs, config };
		return config;
	} catch (err: unknown) {
		const e = err as NodeJS.ErrnoException;
		if (e && e.code === "ENOENT") {
			if (!cache) {
				console.warn(
					`[hello] no config at ${CONFIG_PATH}; using fallback example config`,
				);
			}
			return FALLBACK;
		}
		// Invalidate the cache on any other error so the next request re-reads.
		cache = undefined;
		throw err;
	}
}
