/**
 * JSON Schema (draft 2020-12) for config.json.
 *
 * Source of truth for editor autocomplete + validation. Kept in sync with the
 * types in ./config.ts by hand -- if you edit one, edit the other.
 *
 * Served at /schema/config.json (see src/pages/schema/config.json.ts) so you
 * can point `"$schema"` at a live URL and have editors fetch the current
 * version of the schema for your running deployment.
 */

export const configSchema = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	$id: "https://github.com/abs3ntdev/hello/schema/config.json",
	title: "hello config",
	description:
		"Configuration for the `hello` minimalist homepage / iframe dashboard.",
	type: "object",
	additionalProperties: false,
	required: ["tabs"],
	properties: {
		$schema: {
			type: "string",
			description:
				"URL of the JSON Schema for this file. Editors use it to provide autocomplete.",
		},
		title: {
			type: "string",
			minLength: 1,
			default: "hello",
			description:
				"Page title and PWA app name. Shown in the browser tab and when the site is installed as a PWA.",
		},
		defaultTab: {
			type: "string",
			description:
				"`id` of the tab to open on first load. Must match one of `tabs[].id`. Defaults to the first tab.",
		},
		tabs: {
			type: "array",
			minItems: 1,
			description: "The list of sites shown as icons in the sidebar.",
			items: { $ref: "#/$defs/tab" },
		},
	},
	$defs: {
		tab: {
			type: "object",
			additionalProperties: false,
			required: ["id", "name", "url", "icon"],
			properties: {
				id: {
					type: "string",
					pattern: "^[A-Za-z0-9_-]+$",
					description:
						"Unique, stable identifier. Used in the URL hash (e.g. `#sonarr`) and in DOM ids. Letters, digits, `-` and `_` only.",
				},
				name: {
					type: "string",
					minLength: 1,
					description: "Display name. Shown in the tooltip and page title.",
				},
				url: {
					type: "string",
					format: "uri",
					description: "The URL to load in the iframe for this tab.",
				},
				icon: {
					type: "string",
					minLength: 1,
					description:
						"Icon. Any of:\n" +
						"- Emoji or text: `📺`\n" +
						"- Absolute URL: `https://.../logo.png`\n" +
						"- Path served by this app: `/icons/custom.svg`\n" +
						"- selfh.st compact: `sh-plex`, `sh-plex.png`, `sh-plex-light.webp`\n" +
						"- selfh.st explicit (supports light/dark variants): `selfhst:plex`, `selfhst:plex/light`, `selfhst:plex.png`, `selfhst:plex/dark.webp`",
					examples: [
						"📺",
						"sh-sonarr",
						"sh-plex.png",
						"selfhst:plex",
						"selfhst:grafana/light",
						"https://example.com/logo.svg",
					],
				},
				preload: {
					type: "boolean",
					default: false,
					description:
						"If true, the iframe is built at boot (but hidden) so the page is already loaded when you first click this tab.",
				},
				group: {
					type: "string",
					minLength: 1,
					description:
						"Group label. Tabs sharing a group render together in the sidebar with a thin divider between groups. Groups appear in the order their label is first seen in the config.",
				},
				sandbox: {
					type: "string",
					description:
						"iframe `sandbox` attribute. Space-separated tokens (e.g. `allow-scripts allow-same-origin`).",
				},
				allow: {
					type: "string",
					description:
						"iframe `allow` attribute. Semicolon-separated feature policy tokens (e.g. `fullscreen; autoplay`).",
				},
			},
		},
	},
} as const;
