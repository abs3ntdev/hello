/**
 * Server-side health probe.
 *
 * Opens a raw HTTP HEAD request (falling back to GET) against the target
 * URL with a short timeout. Homelab services often use self-signed certs
 * or plain HTTP on the LAN, so we disable TLS verification for https
 * targets — acceptable because the URLs come from the trusted config file,
 * not from user input.
 *
 * Returns:
 *   - { ok: true,  latencyMs, status }  reachable (any HTTP status)
 *   - { ok: false, reason }             unreachable / timeout / DNS
 *
 * A 401 / 403 / 500 counts as "up" — the dashboard only cares whether the
 * service is serving, not whether the probing UA is authed.
 */

import * as http from "node:http";
import * as https from "node:https";

export interface PingResult {
	ok: boolean;
	/** Milliseconds from request send to first response byte. */
	latencyMs?: number;
	/** HTTP status code for the probe (when reached). */
	status?: number;
	/** Human-readable reason when !ok. */
	reason?: string;
}

const PING_TIMEOUT_MS = 3_000;

// Reuse connections to cut ping cost on the steady state.
const httpAgent = new http.Agent({
	keepAlive: true,
	timeout: PING_TIMEOUT_MS,
	maxSockets: 64,
});
const httpsAgent = new https.Agent({
	keepAlive: true,
	timeout: PING_TIMEOUT_MS,
	maxSockets: 64,
	// LAN services run self-signed TLS more often than not.
	rejectUnauthorized: false,
});

function probeOnce(url: string, method: "HEAD" | "GET"): Promise<PingResult> {
	return new Promise((resolve) => {
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			resolve({ ok: false, reason: "invalid-url" });
			return;
		}
		const isHttps = parsed.protocol === "https:";
		const lib = isHttps ? https : http;
		const start = performance.now();
		let settled = false;
		const finish = (r: PingResult) => {
			if (settled) return;
			settled = true;
			resolve(r);
		};

		const req = lib.request(
			{
				protocol: parsed.protocol,
				hostname: parsed.hostname,
				port:
					parsed.port ||
					(isHttps ? 443 : 80),
				path: `${parsed.pathname}${parsed.search}`,
				method,
				agent: isHttps ? httpsAgent : httpAgent,
				timeout: PING_TIMEOUT_MS,
				headers: {
					"user-agent": "hello/healthcheck",
				},
			},
			(res) => {
				const latencyMs = Math.round(performance.now() - start);
				// Drain the body on success to release the socket back to the
				// keep-alive pool. Essential for steady-state correctness.
				res.resume();
				res.on("end", () => {
					finish({ ok: true, latencyMs, status: res.statusCode });
				});
				res.on("error", () => {
					// Already have a status; still counts as up.
					finish({ ok: true, latencyMs, status: res.statusCode });
				});
			},
		);

		req.on("timeout", () => {
			req.destroy();
			finish({ ok: false, reason: "timeout" });
		});
		req.on("error", (err: NodeJS.ErrnoException) => {
			finish({ ok: false, reason: err.code ?? err.message ?? "error" });
		});
		req.end();
	});
}

/**
 * Probe a URL. Tries HEAD first; retries with GET when HEAD doesn't give
 * a clean 2xx. Specifically we retry on:
 *   - transport-level failure (timeout, refused, DNS)
 *   - any HTTP status outside 200–299
 *
 * Rationale: a 2xx from HEAD is a definitive "up". Anything else is worth
 * a second look with GET before we decide — some upstreams reject HEAD
 * with 405, 403, or 501 but cheerfully answer GET, and 3xx redirects often
 * hide auth walls or stale URLs we'd rather see resolved.
 *
 * The GET result is authoritative even if its status is non-2xx; we only
 * mark "down" on transport-level failures. An auth wall returning 401/403
 * still means the service is serving, and that's all a health check cares
 * about.
 */
function isHealthy(code: number | undefined): boolean {
	return typeof code === "number" && code >= 200 && code < 300;
}

export async function ping(url: string): Promise<PingResult> {
	const head = await probeOnce(url, "HEAD");
	if (head.ok && isHealthy(head.status)) return head;
	return probeOnce(url, "GET");
}
