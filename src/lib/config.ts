import { readFile } from "node:fs/promises";
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
}

export interface AppConfig {
	/** Page title / brand text in the sidebar. */
	title: string;
	/** Tab to open on first load. Defaults to the first tab. */
	defaultTab?: string;
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
		// Validate icon syntax now so typos fail fast on page refresh.
		try {
			resolveIcon(tab.icon as string);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			throw new Error(`config.json: tabs[${i}].${msg}`);
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
	return {
		title: typeof c.title === "string" && c.title ? c.title : "hello",
		defaultTab,
		tabs,
	};
}

/**
 * Read and validate the config on every call. Cheap enough for this use case
 * and means edits to the mounted config.json take effect on page refresh with
 * no restart.
 */
export async function loadConfig(): Promise<AppConfig> {
	try {
		const txt = await readFile(CONFIG_PATH, "utf8");
		return validate(JSON.parse(txt));
	} catch (err: unknown) {
		const e = err as NodeJS.ErrnoException;
		if (e && e.code === "ENOENT") {
			console.warn(
				`[hello] no config at ${CONFIG_PATH}; using fallback example config`,
			);
			return FALLBACK;
		}
		throw err;
	}
}
