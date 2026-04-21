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

	document.title = `${meta.button.title} · ${document.documentElement.dataset.brand ?? "hello"}`;
	const hash = `#${encodeURIComponent(id)}`;
	if (location.hash !== hash) {
		history.replaceState(null, "", hash);
	}
}

function init(): void {
	const tabs = collectTabs();
	if (tabs.size === 0) return;

	// Wire up sidebar buttons.
	for (const meta of tabs.values()) {
		meta.button.addEventListener("click", () => switchTab(tabs, meta.id));
	}

	// Determine which tab is currently visible (server marked one container
	// without .hidden) and mark it loaded so we don't double-create its iframe.
	let activeId: string | undefined;
	for (const meta of tabs.values()) {
		if (!meta.container.classList.contains("hidden")) {
			activeId = meta.id;
			ensureLoaded(meta);
			meta.button.classList.add("active");
			meta.button.setAttribute("aria-selected", "true");
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
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
	init();
}
