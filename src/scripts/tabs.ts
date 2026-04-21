/**
 * Tab controller.
 *
 * Mirrors Organizr's switchTab() behavior without the PHP/jQuery baggage:
 *   - One <div class="frame-container"> per tab is server-rendered up front.
 *   - The iframe inside is created lazily on first switch, OR eagerly at boot
 *     if the tab is marked preload=1.
 *   - Switching only toggles a `hidden` class on containers; iframes are never
 *     destroyed, so scroll position, running JS, WebSockets, and video state
 *     all survive tab switches.
 *
 * Click modifiers (match Organizr's mouse behavior):
 *   - Plain click        : switch tab
 *   - Middle click       : open tab URL in a new browser tab
 *   - Ctrl / Cmd click   : open tab URL in a new browser tab
 */

interface TabMeta {
	id: string;
	url: string;
	sandbox: string;
	allow: string;
	container: HTMLDivElement;
	button: HTMLButtonElement;
	loaded: boolean;
}

function buildIframe(meta: TabMeta): HTMLIFrameElement {
	const iframe = document.createElement("iframe");
	iframe.src = meta.url;
	iframe.id = `frame-${meta.id}`;
	iframe.className = "iframe";
	iframe.setAttribute("frameborder", "0");
	if (meta.sandbox) iframe.setAttribute("sandbox", meta.sandbox);
	if (meta.allow) iframe.setAttribute("allow", meta.allow);
	return iframe;
}

function ensureLoaded(meta: TabMeta): void {
	if (meta.loaded) return;
	meta.container.appendChild(buildIframe(meta));
	meta.loaded = true;
	meta.button.dataset.loaded = "1";
}

function collectTabs(): Map<string, TabMeta> {
	const map = new Map<string, TabMeta>();
	const containers =
		document.querySelectorAll<HTMLDivElement>(".frame-container");
	for (const container of containers) {
		const id = container.dataset.tabId;
		if (!id) continue;
		const button = document.querySelector<HTMLButtonElement>(
			`.tab-button[data-tab-id="${CSS.escape(id)}"]`,
		);
		if (!button) continue;
		map.set(id, {
			id,
			url: container.dataset.url ?? "",
			sandbox: container.dataset.sandbox ?? "",
			allow: container.dataset.allow ?? "",
			container,
			button,
			loaded: false,
		});
	}
	return map;
}

let currentId: string | undefined;

function switchTab(tabs: Map<string, TabMeta>, id: string): void {
	const meta = tabs.get(id);
	if (!meta) return;

	for (const other of tabs.values()) {
		other.container.classList.add("hidden");
		other.button.classList.remove("active");
		other.button.setAttribute("aria-selected", "false");
	}

	ensureLoaded(meta);
	meta.container.classList.remove("hidden");
	meta.button.classList.add("active");
	meta.button.setAttribute("aria-selected", "true");
	currentId = meta.id;

	const name = meta.button.dataset.name ?? meta.button.title;
	document.title = `${name} · ${document.documentElement.dataset.brand ?? "hello"}`;
	const hash = `#${encodeURIComponent(id)}`;
	if (location.hash !== hash) {
		history.replaceState(null, "", hash);
	}
}

function openInNewTab(meta: TabMeta): void {
	window.open(meta.url, "_blank", "noopener,noreferrer");
}

/**
 * Reload the currently visible tab's iframe. Shows a brief spinner on the
 * floating reload button while the iframe reports back `load`.
 *
 * We prefer `contentWindow.location.reload()` because reassigning `iframe.src`
 * is a *navigation* to the same URL, not a true reload — it drops any fragment
 * the iframe's own JS may have pushed (`#/dashboard`). Cross-origin iframes
 * throw `SecurityError` on `contentWindow.location` access, so we fall back to
 * `src = src` for those (which is what Organizr does).
 */
function reloadCurrent(tabs: Map<string, TabMeta>, btn: HTMLElement): void {
	if (!currentId) return;
	const meta = tabs.get(currentId);
	if (!meta?.loaded) return;
	const iframe = meta.container.querySelector<HTMLIFrameElement>("iframe");
	if (!iframe) return;

	btn.dataset.loading = "1";
	const done = () => {
		btn.dataset.loading = "0";
		iframe.removeEventListener("load", done);
	};
	iframe.addEventListener("load", done, { once: true });
	// Safety timeout in case `load` never fires (cross-origin edge cases).
	setTimeout(done, 8000);

	try {
		// Preserves the iframe's current URL (including fragment).
		iframe.contentWindow?.location.reload();
	} catch {
		// Cross-origin: can't touch .location. Fall back to src reassignment.
		// Loses an in-iframe fragment but is the best we can do.
		// biome-ignore lint/correctness/noSelfAssign: intentional iframe reload
		iframe.src = iframe.src;
	}
}

function wireButton(tabs: Map<string, TabMeta>, meta: TabMeta): void {
	const openNewTabModifier = (e: MouseEvent): boolean =>
		e.ctrlKey || e.metaKey || e.button === 1;

	meta.button.addEventListener("click", (e) => {
		if (openNewTabModifier(e)) {
			e.preventDefault();
			openInNewTab(meta);
			return;
		}
		switchTab(tabs, meta.id);
	});

	// Middle-click arrives as `auxclick` (button === 1). Some browsers also
	// fire a regular `click` for it; the `openNewTabModifier` check above
	// covers both paths so we don't open twice.
	meta.button.addEventListener("auxclick", (e) => {
		if (e.button !== 1) return;
		e.preventDefault();
		openInNewTab(meta);
	});

	// Prevent the default middle-click autoscroll cursor.
	meta.button.addEventListener("mousedown", (e) => {
		if (e.button === 1) e.preventDefault();
	});
}

function mountReloadButton(
	tabs: Map<string, TabMeta>,
): HTMLButtonElement | undefined {
	const btn = document.getElementById("reload-btn");
	if (!(btn instanceof HTMLButtonElement)) return undefined;
	btn.addEventListener("click", () => reloadCurrent(tabs, btn));
	return btn;
}

function init(): void {
	const tabs = collectTabs();
	if (tabs.size === 0) return;

	for (const meta of tabs.values()) wireButton(tabs, meta);
	mountReloadButton(tabs);

	// Determine which tab is currently visible (server marked one container
	// without .hidden) and mark it loaded so we don't double-create its iframe.
	let activeId: string | undefined;
	for (const meta of tabs.values()) {
		if (!meta.container.classList.contains("hidden")) {
			activeId = meta.id;
			ensureLoaded(meta);
			meta.button.classList.add("active");
			meta.button.setAttribute("aria-selected", "true");
			currentId = meta.id;
			break;
		}
	}

	// Preload other tabs marked preload=1 — build their iframes while they
	// remain .hidden so they load in the background.
	for (const meta of tabs.values()) {
		if (meta.id === activeId) continue;
		if (meta.container.dataset.preload === "1") {
			ensureLoaded(meta);
		}
	}

	// Honor URL hash for deep-linking on reload.
	const hashId = decodeURIComponent(location.hash.slice(1));
	if (hashId && tabs.has(hashId) && hashId !== activeId) {
		switchTab(tabs, hashId);
	}

	window.addEventListener("hashchange", () => {
		const id = decodeURIComponent(location.hash.slice(1));
		if (id && tabs.has(id)) switchTab(tabs, id);
	});

	if (document.documentElement.dataset.liveReload === "1") {
		connectLiveReload();
	}

	// Load the extras (health polling + command palette) as dynamic imports
	// so the main-thread blocking time stays small. Both depend only on the
	// DOM we've already wired, so a delayed load is safe.
	void import("./health").then((m) => m.startHealthPolling());
	void import("./palette").then((m) => m.mountPalette());
}

/**
 * Open a Server-Sent Events stream to /events and reload the page when the
 * server reports a config change.
 *
 * Fair warning: reloading the page wipes all cached iframe state. That's a
 * worthwhile trade for a rare config edit, not for frequent iteration.
 *
 * EventSource auto-reconnects on transient failures, so we don't need a
 * reconnect loop. We DO bail if the server ever 404s the endpoint (meaning
 * live-reload was turned off on the server without redeploying the page).
 */
function connectLiveReload(): void {
	let source: EventSource | undefined;
	try {
		source = new EventSource("/events");
	} catch {
		return;
	}
	source.addEventListener("reload", () => {
		// Preserve the current tab across the reload.
		location.reload();
	});
	source.addEventListener("error", () => {
		// EventSource's readyState === CLOSED means a non-retryable error
		// (typically the endpoint returned 404/5xx). Let the browser give up
		// rather than spinning the reconnect timer forever.
		if (source && source.readyState === EventSource.CLOSED) {
			source.close();
		}
	});
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
	init();
}
