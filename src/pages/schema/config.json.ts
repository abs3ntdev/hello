import type { APIRoute } from "astro";
import { configSchema } from "../../lib/schema";

/**
 * Public JSON Schema for config.json.
 *
 * Stable URL: /schema/config.json
 *
 * Point `"$schema"` in your config.json at this endpoint (or at the raw file
 * in the repo) to get autocomplete + validation in VS Code / Zed / nvim /
 * anything that speaks JSON Schema.
 */
export const GET: APIRoute = () =>
	new Response(JSON.stringify(configSchema, null, 2), {
		headers: {
			"content-type": "application/schema+json; charset=utf-8",
			"cache-control": "public, max-age=300",
			"access-control-allow-origin": "*",
		},
	});
