/**
 * Per-tab health polling.
 *
 * For each tab button with data-ping="1" we hit GET /api/ping?id=... every
 * POLL_INTERVAL_MS. The server does the actual network probe (necessary
 * since the browser can't reach private LAN services or bypass CORS), and
 * we just toggle a data-health attribute on the button which CSS styles as
 * a coloured dot.
 *
 * States:
 *   data-health="up"      green dot, small "Xms" tooltip suffix on hover
 *   data-health="down"    red dot, pulsing
 *   data-health="checking" neutral dot while the first check is in flight
 *   (absent)              no health check for this tab
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

function applyResult(btn: HTMLElement, result: PingResponse | undefined): void {
	if (!result) {
		// Network error to our own server — don't overwrite an existing good
		// state, just mark as unknown if we never had one.
		if (!btn.dataset.health) btn.dataset.health = "unknown";
		return;
	}
	btn.dataset.health = result.status;
	if (result.status === "up" && typeof result.latencyMs === "number") {
		btn.dataset.latency = String(result.latencyMs);
	} else {
		delete btn.dataset.latency;
	}
}

export function startHealthPolling(): void {
	const buttons = Array.from(
		document.querySelectorAll<HTMLButtonElement>(
			'.tab-button[data-ping="1"]',
		),
	);
	if (buttons.length === 0) return;

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

	// Pause/resume on page visibility change — saves requests while the tab
	// is backgrounded, refreshes promptly when it comes back.
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState !== "visible") return;
		for (const btn of buttons) {
			const id = btn.dataset.tabId;
			if (!id) continue;
			void pingTab(id).then((r) => applyResult(btn, r));
		}
	});
}
