/**
 * Icon resolver.
 *
 * Supports five icon syntaxes in config:
 *   1. Emoji / plain text:             "icon": "📺"
 *   2. Absolute URL:                   "icon": "https://example.com/logo.png"
 *   3. Path served by this app:        "icon": "/icons/custom.svg"
 *   4. selfh.st shorthand — homepage/dashy compatible `sh-` form:
 *        "icon": "sh-plex"             -> plex (svg, default variant)
 *        "icon": "sh-plex.png"         -> plex.png
 *        "icon": "sh-plex-light"       -> plex-light.svg (literal filename)
 *        "icon": "sh-plex-light.webp"  -> plex-light.webp
 *   5. selfh.st shorthand — explicit `selfhst:` form (supports /variant):
 *        "icon": "selfhst:plex"
 *        "icon": "selfhst:plex/light"
 *        "icon": "selfhst:plex/dark"
 *        "icon": "selfhst:plex.png"
 *        "icon": "selfhst:plex/dark.webp"
 *
 * Notes on defaults:
 *   - Default format is **svg** (selfh.st ships SVGs when available and
 *     recommends them; homepage defaults to png, dashy to webp — we pick the
 *     highest-quality default).
 *   - The collection is served from the jsDelivr CDN mirror of
 *     https://github.com/selfhst/icons pinned to `@main`, matching homepage.
 */

const SELFHST_CDN = "https://cdn.jsdelivr.net/gh/selfhst/icons@main";
const SELFHST_FORMATS = new Set(["svg", "png", "webp", "avif", "ico"]);
const SELFHST_VARIANTS = new Set(["light", "dark"]);

export type IconKind = "image" | "text";

export interface ResolvedIcon {
	kind: IconKind;
	value: string;
}

function splitExtension(body: string): { stem: string; format: string } {
	const dot = body.lastIndexOf(".");
	if (dot === -1) return { stem: body, format: "svg" };
	const maybeExt = body.slice(dot + 1).toLowerCase();
	if (SELFHST_FORMATS.has(maybeExt)) {
		return { stem: body.slice(0, dot), format: maybeExt };
	}
	// Not a recognized format suffix — treat as part of the stem.
	return { stem: body, format: "svg" };
}

/**
 * `selfhst:plex`                 -> svg/plex.svg
 * `selfhst:plex/light`           -> svg/plex-light.svg
 * `selfhst:plex/dark`            -> svg/plex-dark.svg
 * `selfhst:plex.png`             -> png/plex.png
 * `selfhst:plex/dark.webp`       -> webp/plex-dark.webp
 */
function resolveSelfhstExplicit(spec: string): string {
	const body = spec.slice("selfhst:".length);
	if (!body) throw new Error(`icon "${spec}": empty selfhst spec`);

	const { stem, format } = splitExtension(body);

	// Reject a dot in the stem we didn't consume — that means the extension
	// wasn't in our allow-list.
	if (stem.includes(".")) {
		throw new Error(
			`icon "${spec}": unsupported format (expected one of: ` +
				`${[...SELFHST_FORMATS].join(", ")})`,
		);
	}

	let slug: string;
	let variant: string | undefined;
	const slash = stem.indexOf("/");
	if (slash === -1) {
		slug = stem;
	} else {
		slug = stem.slice(0, slash);
		variant = stem.slice(slash + 1);
		if (variant.includes("/")) {
			throw new Error(`icon "${spec}": only one variant segment is allowed`);
		}
		if (!SELFHST_VARIANTS.has(variant)) {
			throw new Error(
				`icon "${spec}": unknown variant "${variant}" ` +
					`(expected one of: ${[...SELFHST_VARIANTS].join(", ")})`,
			);
		}
	}

	if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
		throw new Error(
			`icon "${spec}": slug "${slug}" must be lowercase alphanumeric with dashes`,
		);
	}

	const file = variant ? `${slug}-${variant}.${format}` : `${slug}.${format}`;
	return `${SELFHST_CDN}/${format}/${file}`;
}

/**
 * `sh-plex`                 -> svg/plex.svg
 * `sh-plex.png`             -> png/plex.png
 * `sh-plex-light`           -> svg/plex-light.svg   (literal filename)
 * `sh-plex-light.webp`      -> webp/plex-light.webp
 *
 * Matches the `sh-` convention established by gethomepage/homepage and
 * Lissy93/dashy, so configs can be copy-pasted between dashboards.
 */
function resolveSelfhstShort(spec: string): string {
	const body = spec.slice("sh-".length);
	if (!body) throw new Error(`icon "${spec}": empty sh- spec`);

	const { stem, format } = splitExtension(body);

	if (stem.includes(".")) {
		throw new Error(
			`icon "${spec}": unsupported format (expected one of: ` +
				`${[...SELFHST_FORMATS].join(", ")})`,
		);
	}
	if (!/^[a-z0-9][a-z0-9-]*$/.test(stem)) {
		throw new Error(
			`icon "${spec}": name "${stem}" must be lowercase alphanumeric with dashes`,
		);
	}

	return `${SELFHST_CDN}/${format}/${stem}.${format}`;
}

/** Resolve a raw config icon string into something renderable. */
export function resolveIcon(icon: string): ResolvedIcon {
	if (icon.startsWith("selfhst:")) {
		return { kind: "image", value: resolveSelfhstExplicit(icon) };
	}
	if (icon.startsWith("sh-")) {
		return { kind: "image", value: resolveSelfhstShort(icon) };
	}
	if (icon.startsWith("http://") || icon.startsWith("https://")) {
		return { kind: "image", value: icon };
	}
	if (icon.startsWith("/")) {
		return { kind: "image", value: icon };
	}
	return { kind: "text", value: icon };
}
