/**
 * Command palette: `/` or Ctrl/Cmd+K opens a fuzzy tab picker.
 *
 * - Arrow keys / Tab to move the selection
 * - Enter to switch to the highlighted tab
 * - Ctrl/Meta + Enter (or middle-click on a result) to open in a new browser tab
 * - Esc or click outside to close
 *
 * Uses `fzf` (ajitid/fzf-for-js) for the matcher, so you get the same
 * algorithm and highlight positions as the CLI tool — typing `snr` matches
 * `Sonarr` with highlights on the right chars.
 */

import { Fzf } from "fzf";

interface PaletteEntry {
	id: string;
	name: string;
	group: string;
	/** Composite string fzf searches over: "Name Group". */
	haystack: string;
	/** Cached <img>/<span> icon node so we can reuse it in results. */
	iconHtml: string;
}

/**
 * Build the entry list from the already-rendered sidebar. Single source of
 * truth: whatever Astro rendered is what the palette sees.
 */
function collectEntries(): PaletteEntry[] {
	const buttons = Array.from(
		document.querySelectorAll<HTMLButtonElement>(".tab-button"),
	);
	return buttons.map((btn) => {
		const id = btn.dataset.tabId ?? "";
		const name = btn.dataset.name ?? btn.title ?? id;
		const group = btn.dataset.group ?? "";
		const iconWrap = btn.querySelector<HTMLElement>(".icon");
		return {
			id,
			name,
			group,
			haystack: group ? `${name} ${group}` : name,
			iconHtml: iconWrap?.innerHTML ?? "",
		};
	});
}

/**
 * Wrap the matched char indices (fzf's `positions`) in <mark> tags so the
 * UI can highlight exactly what matched the query.
 */
function highlight(text: string, positions: Set<number>): string {
	if (positions.size === 0) return escapeHtml(text);
	let out = "";
	for (let i = 0; i < text.length; i++) {
		const ch = escapeHtml(text[i]!);
		out += positions.has(i) ? `<mark>${ch}</mark>` : ch;
	}
	return out;
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function buildShell(): {
	root: HTMLDivElement;
	input: HTMLInputElement;
	list: HTMLUListElement;
} {
	const root = document.createElement("div");
	root.className = "palette";
	root.setAttribute("role", "dialog");
	root.setAttribute("aria-modal", "true");
	root.setAttribute("aria-label", "Jump to tab");
	root.hidden = true;
	root.innerHTML = `
		<div class="palette-backdrop" data-dismiss></div>
		<div class="palette-panel">
			<input
				type="text"
				class="palette-input"
				placeholder="Jump to tab..."
				autocomplete="off"
				spellcheck="false"
				aria-label="Search tabs"
			/>
			<ul class="palette-list" role="listbox"></ul>
			<div class="palette-hint">
				<span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
				<span><kbd>↵</kbd> switch</span>
				<span><kbd>Ctrl</kbd>+<kbd>↵</kbd> new window</span>
				<span><kbd>Esc</kbd> close</span>
			</div>
		</div>
	`;
	document.body.appendChild(root);
	const input = root.querySelector<HTMLInputElement>(".palette-input")!;
	const list = root.querySelector<HTMLUListElement>(".palette-list")!;
	return { root, input, list };
}

export function mountPalette(): void {
	const entries = collectEntries();
	if (entries.length === 0) return;

	const fzf = new Fzf(entries, {
		selector: (e) => e.haystack,
		limit: 50,
	});

	const { root, input, list } = buildShell();
	let selectedIndex = 0;
	let currentResults: Array<{
		entry: PaletteEntry;
		positions: Set<number>;
	}> = [];

	const render = (query: string) => {
		if (!query) {
			// Empty query: show everything in sidebar order.
			currentResults = entries.map((entry) => ({
				entry,
				positions: new Set<number>(),
			}));
		} else {
			currentResults = fzf.find(query).map((r) => ({
				entry: r.item,
				positions: r.positions,
			}));
		}
		if (selectedIndex >= currentResults.length) selectedIndex = 0;
		list.innerHTML = currentResults
			.map(({ entry, positions }, i) => {
				// fzf positions index into the haystack ("Name Group"). Split
				// them back into name/group offsets so we highlight each half
				// independently.
				const namePositions = new Set<number>();
				const groupPositions = new Set<number>();
				const nameLen = entry.name.length;
				for (const p of positions) {
					if (p < nameLen) namePositions.add(p);
					else if (p > nameLen) groupPositions.add(p - nameLen - 1);
				}
				const nameHtml = highlight(entry.name, namePositions);
				const groupHtml = entry.group
					? `<span class="palette-group">${highlight(entry.group, groupPositions)}</span>`
					: "";
				return `
					<li
						class="palette-item${i === selectedIndex ? " selected" : ""}"
						role="option"
						aria-selected="${i === selectedIndex}"
						data-index="${i}"
						data-id="${escapeHtml(entry.id)}"
					>
						<span class="palette-icon">${entry.iconHtml}</span>
						<span class="palette-name">${nameHtml}</span>
						${groupHtml}
					</li>
				`;
			})
			.join("");
	};

	const pickByIndex = (idx: number, openNew: boolean) => {
		const entry = currentResults[idx]?.entry;
		if (!entry) return;
		close();
		const btn = document.querySelector<HTMLButtonElement>(
			`.tab-button[data-tab-id="${CSS.escape(entry.id)}"]`,
		);
		if (!btn) return;
		if (openNew) {
			const url = btn.dataset.url;
			if (url) window.open(url, "_blank", "noopener,noreferrer");
		} else {
			btn.click();
		}
	};

	const moveSelection = (delta: number) => {
		if (currentResults.length === 0) return;
		selectedIndex =
			(selectedIndex + delta + currentResults.length) %
			currentResults.length;
		// Re-render selection only (cheaper than full re-render).
		for (const li of list.querySelectorAll<HTMLLIElement>(".palette-item")) {
			const idx = Number(li.dataset.index);
			const on = idx === selectedIndex;
			li.classList.toggle("selected", on);
			li.setAttribute("aria-selected", on ? "true" : "false");
			if (on) li.scrollIntoView({ block: "nearest" });
		}
	};

	const open = () => {
		if (!root.hidden) return;
		root.hidden = false;
		input.value = "";
		selectedIndex = 0;
		render("");
		input.focus();
	};

	const close = () => {
		if (root.hidden) return;
		root.hidden = true;
		input.value = "";
		currentResults = [];
	};

	input.addEventListener("input", () => {
		selectedIndex = 0;
		render(input.value.trim());
	});

	input.addEventListener("keydown", (e) => {
		switch (e.key) {
			case "ArrowDown":
			case "Tab":
				e.preventDefault();
				moveSelection(1);
				break;
			case "ArrowUp":
				e.preventDefault();
				moveSelection(-1);
				break;
			case "Enter":
				e.preventDefault();
				pickByIndex(selectedIndex, e.ctrlKey || e.metaKey);
				break;
			case "Escape":
				e.preventDefault();
				close();
				break;
		}
	});

	list.addEventListener("click", (e) => {
		const li = (e.target as HTMLElement).closest<HTMLLIElement>(
			".palette-item",
		);
		if (!li) return;
		const idx = Number(li.dataset.index);
		pickByIndex(idx, e.ctrlKey || e.metaKey || (e as MouseEvent).button === 1);
	});
	list.addEventListener("auxclick", (e) => {
		if ((e as MouseEvent).button !== 1) return;
		const li = (e.target as HTMLElement).closest<HTMLLIElement>(
			".palette-item",
		);
		if (!li) return;
		e.preventDefault();
		const idx = Number(li.dataset.index);
		pickByIndex(idx, true);
	});

	root.addEventListener("click", (e) => {
		if ((e.target as HTMLElement).dataset.dismiss !== undefined) close();
	});

	// Global shortcuts.
	document.addEventListener("keydown", (e) => {
		if (root.hidden) {
			// Only open on `/` or Ctrl/Meta+K when the user isn't already
			// typing into an input or the iframe has focus.
			const inputFocus = document.activeElement?.tagName;
			if (inputFocus === "INPUT" || inputFocus === "TEXTAREA") return;
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				open();
			} else if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
				e.preventDefault();
				open();
			}
		} else if (e.key === "Escape") {
			close();
		}
	});
}
