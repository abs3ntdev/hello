import type { APIRoute } from "astro";
import { liveReloadEnabled, registerClient } from "../lib/watcher";

/**
 * Server-Sent Events stream that fires a `reload` event whenever config.json
 * changes on disk. The client-side tabs script opens an EventSource to this
 * route and calls location.reload() when it hears the event.
 *
 * Enable with HELLO_LIVE_RELOAD=1. When disabled the endpoint 404s, which
 * also signals the client to stop trying to reconnect.
 */
export const GET: APIRoute = ({ request }) => {
	if (!liveReloadEnabled()) {
		return new Response("live-reload disabled", { status: 404 });
	}
	const stream = registerClient(request.signal);
	if (!stream) {
		return new Response("too many live-reload clients", {
			status: 503,
			headers: { "retry-after": "30" },
		});
	}
	return new Response(stream, {
		headers: {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-cache, no-transform",
			connection: "keep-alive",
			// Defuses nginx's default proxy_buffering for this specific
			// response. Has no effect on Caddy (which doesn't buffer).
			"x-accel-buffering": "no",
		},
	});
};
