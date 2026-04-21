/**
 * Config file watcher + SSE broadcaster.
 *
 * Wraps chokidar with a debounce and a content-hash so we only notify
 * browsers when the file actually changes (editors routinely fire multiple
 * FS events per save — rename, truncate, write, chmod, etc).
 *
 * The module is imported lazily by the /events route so it's only spun up
 * when live-reload is enabled, avoiding chokidar overhead in the default
 * production path.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";

const CONFIG_PATH =
	process.env.HELLO_CONFIG ?? resolve(process.cwd(), "config", "config.json");

/**
 * Write handle for a connected SSE client. We hold onto the underlying
 * controller so we can write more messages over time, and call `close` so
 * we can hang up cleanly on shutdown.
 */
interface Client {
	controller: ReadableStreamDefaultController<Uint8Array>;
	close: () => void;
}

const encoder = new TextEncoder();
const clients = new Set<Client>();

/**
 * Cap concurrent SSE clients. Prevents FD / memory exhaustion if something
 * opens many connections. 256 is generous for this app's real use (one or
 * two open tabs per user) while staying well under Node's default FD limit.
 */
const MAX_CLIENTS = Number.parseInt(process.env.HELLO_MAX_SSE_CLIENTS ?? "", 10) || 256;

let watcher: FSWatcher | undefined;
let lastHash: string | undefined;
let debounceTimer: NodeJS.Timeout | undefined;

async function fileHash(path: string): Promise<string | undefined> {
	try {
		const buf = await readFile(path);
		return createHash("sha1").update(buf).digest("hex");
	} catch {
		return undefined;
	}
}

function broadcast(event: string, data = ""): void {
	// SSE message format: `event: foo\ndata: bar\n\n`
	const payload = encoder.encode(`event: ${event}\ndata: ${data}\n\n`);
	for (const client of clients) {
		try {
			client.controller.enqueue(payload);
		} catch {
			// Controller already closed on the other side; drop the client.
			clients.delete(client);
			client.close();
		}
	}
}

async function handleChange(): Promise<void> {
	const hash = await fileHash(CONFIG_PATH);
	if (!hash || hash === lastHash) return;
	lastHash = hash;
	broadcast("reload", hash);
}

function startWatcher(): void {
	if (watcher) return;
	// Watch the parent directory, not the file directly — when an editor
	// replaces the file atomically (write-then-rename), a direct file watch
	// can lose the inode and stop firing. Watching the dir is robust.
	const dir = dirname(CONFIG_PATH);
	watcher = chokidar.watch(CONFIG_PATH, {
		cwd: dir,
		ignoreInitial: true,
		awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
		// Some filesystems (bind-mounted docker volumes, network FS) don't
		// deliver inotify events. Fall back to polling so live-reload works
		// on all setups rather than silently not working on some.
		usePolling: process.env.HELLO_WATCH_POLLING === "1",
		interval: 500,
	});
	const onFsEvent = () => {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			void handleChange();
		}, 120);
	};
	watcher.on("add", onFsEvent);
	watcher.on("change", onFsEvent);
	watcher.on("unlink", onFsEvent);
	watcher.on("error", (err) => {
		console.warn("[hello] config watcher error:", err);
	});

	// Prime the hash so the first *real* change is detected.
	void fileHash(CONFIG_PATH).then((h) => {
		lastHash = h;
	});

	// Clean up if the process exits gracefully (e.g. docker stop -> SIGTERM).
	const shutdown = () => {
		for (const c of clients) c.close();
		clients.clear();
		void watcher?.close();
	};
	process.once("SIGTERM", shutdown);
	process.once("SIGINT", shutdown);
}

/**
 * Register a new SSE client. Returns a ReadableStream you hand back as the
 * body of the /events Response — or `null` when the server's concurrent
 * connection cap has been reached, in which case the caller should reply
 * with 503.
 *
 * Aborting `abortSignal` closes the connection from the caller side;
 * otherwise it stays open until the client disconnects.
 */
export function registerClient(
	abortSignal: AbortSignal,
): ReadableStream<Uint8Array> | null {
	if (clients.size >= MAX_CLIENTS) return null;
	startWatcher();
	let clientRef: Client | undefined;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const close = () => {
				try {
					controller.close();
				} catch {
					// already closed
				}
				if (clientRef) clients.delete(clientRef);
			};
			clientRef = { controller, close };
			clients.add(clientRef);

			// Initial ping so the browser confirms the stream is live and
			// EventSource fires `onopen`.
			controller.enqueue(encoder.encode("event: hello\ndata: connected\n\n"));

			// Keep-alive comment every 25s. Without this, idle proxies (nginx
			// default 60s, some CDNs shorter) will close the connection.
			const keepalive = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(": keepalive\n\n"));
				} catch {
					clearInterval(keepalive);
					close();
				}
			}, 25_000);

			abortSignal.addEventListener("abort", () => {
				clearInterval(keepalive);
				close();
			});
		},
	});
	return stream;
}

export function liveReloadEnabled(): boolean {
	return process.env.HELLO_LIVE_RELOAD === "1";
}
