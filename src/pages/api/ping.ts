import type { APIRoute } from "astro";
import { loadConfig } from "../../lib/config";
import { ping } from "../../lib/ping";

/**
 * Server-side health check for a single tab.
 *
 *   GET /api/ping?id=<tab-id>
 *
 * Returns { status: "up" | "down", latencyMs?, reason? } as JSON.
 *
 * Why this is a GET-only id-keyed endpoint (not a URL-in-query endpoint):
 * we must not become an open SSRF relay. The server only probes URLs that
 * appear in the loaded config file, so even a crafted query param can't
 * redirect the probe anywhere new.
 */
export const GET: APIRoute = async ({ url }) => {
	const id = url.searchParams.get("id");
	if (!id) {
		return Response.json({ error: "missing id" }, { status: 400 });
	}

	const config = await loadConfig();
	const tab = config.tabs.find((t) => t.id === id);
	if (!tab) {
		return Response.json({ error: "unknown tab" }, { status: 404 });
	}
	if (!tab.ping) {
		return Response.json({ error: "ping not enabled" }, { status: 400 });
	}

	const target = typeof tab.ping === "string" ? tab.ping : tab.url;
	const result = await ping(target);

	return Response.json(
		result.ok
			? {
					status: "up",
					latencyMs: result.latencyMs,
					httpStatus: result.status,
				}
			: { status: "down", reason: result.reason },
		{
			headers: {
				"cache-control": "no-store",
			},
		},
	);
};
