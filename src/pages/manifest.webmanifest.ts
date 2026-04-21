import type { APIRoute } from "astro";
import { loadConfig } from "../lib/config";

/**
 * Dynamic web app manifest. Consumed when the user clicks "Install" in a
 * browser that supports PWAs. Reads from the same config.json as the UI so
 * the installed app name tracks the configured `title`.
 *
 * Served from /manifest.webmanifest (the `.webmanifest` suffix is what the
 * browser looks for — it drives the "Add to Home Screen" affordance on
 * mobile and the install prompt on desktop Chromium).
 */
export const GET: APIRoute = async () => {
	const config = await loadConfig();
	const body = {
		name: config.title,
		short_name: config.title,
		description: `${config.title} — iframe dashboard`,
		start_url: "/",
		scope: "/",
		display: "standalone",
		orientation: "any",
		background_color: "#1e1e2e",
		theme_color: "#1e1e2e",
		icons: [
			{
				src: "/favicon.svg",
				sizes: "any",
				type: "image/svg+xml",
				purpose: "any",
			},
			{
				src: "/icon-192.png",
				sizes: "192x192",
				type: "image/png",
				purpose: "any maskable",
			},
			{
				src: "/icon-512.png",
				sizes: "512x512",
				type: "image/png",
				purpose: "any maskable",
			},
		],
	};
	return new Response(JSON.stringify(body, null, 2), {
		headers: {
			"content-type": "application/manifest+json; charset=utf-8",
			// Short cache so a title change in config shows up within seconds.
			"cache-control": "public, max-age=60",
		},
	});
};
