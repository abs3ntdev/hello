/**
 * Per-tab health polling + hover tooltip.
 *
 * For each tab button with data-ping="1" we hit GET /api/ping?id=... every
 * POLL_INTERVAL_MS. The server does the actual network probe (necessary
 * since the browser can't reach private LAN services or bypass CORS), and
 * we update a coloured dot + a rich hover tooltip on the button.
 *
 * Attributes maintained per button:
 *   data-health    "up" | "down" | "checking" | "unknown"
 *   data-latency   latest latency in ms (only when up)
 *   data-status    latest HTTP status (only when up)
 *   data-reason    latest failure reason (only when down)
 *   data-checked   ISO timestamp of the last completed check
 */

const POLL_INTERVAL_MS = 30_000;
const JITTER_MS = 5_000;

interface PingResponse {
	status: "up" | "down";
	latencyMs?: number;
	httpStatus?: number;
	reason?: string;
}

async function pingTab(id: string): Promise<PingResponse | undefined> {
	try {
		const res = await fetch(
			`/api/ping?id=${encodeURIComponent(id)}`,
			{ cache: "no-store" },
		);
		if (!res.ok) return undefined;
		return (await res.json()) as PingResponse;
	} catch {
		return undefined;
	}
}

function applyResult(
	btn: HTMLElement,
	result: PingResponse | undefined,
): void {
	if (!result) {
		// Network error to our own server — don't overwrite an existing good
		// state, just mark as unknown if we never had one.
		if (!btn.dataset.health) btn.dataset.health = "unknown";
		return;
	}
	btn.dataset.health = result.status;
	btn.dataset.checked = new Date().toISOString();
	if (result.status === "up") {
		if (typeof result.latencyMs === "number") {
			btn.dataset.latency = String(result.latencyMs);
		}
		if (typeof result.httpStatus === "number") {
			btn.dataset.status = String(result.httpStatus);
		}
		delete btn.dataset.reason;
	} else {
		delete btn.dataset.latency;
		delete btn.dataset.status;
		btn.dataset.reason = result.reason ?? "unreachable";
	}
}

export function startHealthPolling(): void {
	const buttons = Array.from(
		document.querySelectorAll<HTMLButtonElement>(
			'.tab-button[data-ping="1"]',
		),
	);
	if (buttons.length > 0) {
		for (const btn of buttons) {
			const id = btn.dataset.tabId;
			if (!id) continue;
			btn.dataset.health = "checking";

			const tick = async () => {
				const result = await pingTab(id);
				applyResult(btn, result);
			};

			// Spread initial checks to avoid firing N requests at page load.
			const initialDelay = Math.random() * 1000;
			setTimeout(() => {
				void tick();
				// Add jitter to the interval so independent tabs don't sync up
				// and hammer the server on the same ticks.
				const interval = POLL_INTERVAL_MS + Math.random() * JITTER_MS;
				setInterval(() => void tick(), interval);
			}, initialDelay);
		}

		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState !== "visible") return;
			for (const btn of buttons) {
				const id = btn.dataset.tabId;
				if (!id) continue;
				void pingTab(id).then((r) => applyResult(btn, r));
			}
		});
	}

	// Tooltip is independent of whether any tabs have ping enabled — it
	// shows the name/group even for unpinged tabs.
	mountTooltip();
}

/**
 * Single tooltip element reused across all sidebar buttons. Cheaper than
 * one per button and keeps hover-in / hover-out transitions clean (no
 * element thrashing in the DOM).
 */
function mountTooltip(): void {
	const buttons = Array.from(
		document.querySelectorAll<HTMLButtonElement>(".tab-button"),
	);
	if (buttons.length === 0) return;

	const tip = document.createElement("div");
	tip.className = "tab-tooltip";
	tip.dataset.visible = "0";
	document.body.appendChild(tip);

	let current: HTMLButtonElement | undefined;

	const HEALTH_LABEL: Record<string, string> = {
		up: "up",
		down: "down",
		checking: "checking…",
		unknown: "unknown",
	};

	const formatAge = (iso: string | undefined): string => {
		if (!iso) return "–";
		const t = Date.parse(iso);
		if (!Number.isFinite(t)) return "–";
		const age = Math.max(0, Date.now() - t);
		if (age < 1500) return "just now";
		if (age < 60_000) return `${Math.round(age / 1000)}s ago`;
		if (age < 3_600_000) return `${Math.round(age / 60_000)}m ago`;
		return `${Math.round(age / 3_600_000)}h ago`;
	};

	const render = (btn: HTMLButtonElement) => {
		const name = btn.dataset.name ?? btn.title ?? "";
		const group = btn.dataset.group ?? "";
		const pingEnabled = btn.dataset.ping === "1";
		const health = btn.dataset.health ?? "";
		const latency = btn.dataset.latency;
		const status = btn.dataset.status;
		const reason = btn.dataset.reason;
		const checked = btn.dataset.checked;
		const loaded = btn.dataset.loaded === "1";

		let html = `<div class="tab-tooltip-name">${escapeHtml(name)}</div>`;
		if (group) {
			html += `<div class="tab-tooltip-group">${escapeHtml(group)}</div>`;
		}

		if (pingEnabled) {
			const kind = health || "checking";
			const label = HEALTH_LABEL[kind] ?? kind;
			html += `<div class="tab-tooltip-row" data-kind="${kind}"><span>health</span><strong>${escapeHtml(label)}</strong></div>`;

			if (health === "up") {
				if (latency)
					html += `<div class="tab-tooltip-row"><span>latency</span><strong>${escapeHtml(latency)} ms</strong></div>`;
				if (status)
					html += `<div class="tab-tooltip-row"><span>HTTP</span><strong>${escapeHtml(status)}</strong></div>`;
			} else if (health === "down" && reason) {
				html += `<div class="tab-tooltip-row"><span>reason</span><strong>${escapeHtml(reason)}</strong></div>`;
			}

			if (checked) {
				html += `<div class="tab-tooltip-row"><span>checked</span><strong>${escapeHtml(formatAge(checked))}</strong></div>`;
			}
		}

		if (loaded) {
			html += `<div class="tab-tooltip-row"><span>iframe</span><strong>loaded</strong></div>`;
		}

		tip.innerHTML = html;
	};

	const position = (btn: HTMLButtonElement) => {
		const rect = btn.getBoundingClientRect();
		// Tooltip sits to the right of the sidebar, vertically centered on
		// the button. Clamp to viewport to avoid going off-screen at the
		// top/bottom of long sidebars.
		const top = Math.max(
			8,
			Math.min(
				window.innerHeight - tip.offsetHeight - 8,
				rect.top + rect.height / 2 - tip.offsetHeight / 2,
			),
		);
		tip.style.top = `${top}px`;
	};

	const show = (btn: HTMLButtonElement) => {
		current = btn;
		render(btn);
		tip.dataset.visible = "1";
		// Position *after* render so offsetHeight is measured on final content.
		requestAnimationFrame(() => position(btn));
	};

	const hide = () => {
		current = undefined;
		tip.dataset.visible = "0";
	};

	for (const btn of buttons) {
		btn.addEventListener("mouseenter", () => show(btn));
		btn.addEventListener("mouseleave", hide);
		btn.addEventListener("focus", () => show(btn));
		btn.addEventListener("blur", hide);
	}

	// Re-render tooltip contents whenever a data-* attribute changes on the
	// currently-hovered button, so the "checked" age and health state stay
	// live without needing a fresh hover.
	const observer = new MutationObserver(() => {
		if (current) render(current);
	});
	for (const btn of buttons) {
		observer.observe(btn, {
			attributes: true,
			attributeFilter: [
				"data-health",
				"data-latency",
				"data-status",
				"data-reason",
				"data-checked",
				"data-loaded",
			],
		});
	}

	// Keep the "checked Xs ago" fresh while hovering.
	setInterval(() => {
		if (current) render(current);
	}, 5_000);
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
