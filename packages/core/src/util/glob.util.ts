import { normalizePath } from './path.util.js';

/**
 * Escapes regular-expression metacharacters while leaving stars available for glob conversion.
 *
 * @param text - Literal text or glob pattern to escape.
 * @returns Escaped text with any `*` characters unchanged.
 */
export function escapeRegex(text: string): string {
	// Match every regular-expression metacharacter that must be escaped when inserting literal text.
	return text.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

/**
 * Converts a normalized glob into a case-sensitive expression matching the entire path.
 * Supports `*` within a segment, `**` across segments, and a globstar followed by a slash for optional directory prefixes.
 * Other glob syntax, such as question marks and character classes, is treated literally.
 *
 * @param glob - Pattern to normalize and convert.
 * @returns An anchored regular expression for the supported glob syntax.
 */
export function globToRegex(glob: string): RegExp {
	const normalized = normalizePath(glob);
	const escaped = escapeRegex(normalized)
		// Preserve "**/" before processing single stars because it may match zero directory segments.
		.replace(/\*\*\//g, '__DOUBLE_STAR_SLASH__')
		// Preserve remaining globstars before converting single stars.
		.replace(/\*\*/g, '__DOUBLE_STAR__')
		// A single star matches characters only within one path segment.
		.replace(/\*/g, '[^/]*')
		// A globstar followed by a slash matches zero or more complete directory segments.
		.replace(/__DOUBLE_STAR_SLASH__/g, '(?:.*/)?')
		// A remaining globstar may match across directory boundaries.
		.replace(/__DOUBLE_STAR__/g, '.*');

	// Anchor the generated expression so the glob must match the complete normalized path.
	return new RegExp(`^${escaped}$`);
}

/**
 * Tests whether any supported glob matches the supplied path.
 * Patterns are normalized during conversion, but the path itself is used unchanged.
 *
 * @param path - Path to test, normally using forward slashes.
 * @param patterns - Glob patterns to test in order until one matches.
 * @returns Whether a pattern matches; returns `false` for an empty pattern list.
 */
export function matchesAny(path: string, patterns: string[]): boolean {
	if (patterns.length === 0) {
		return false;
	}

	return patterns.some((pattern) => globToRegex(pattern).test(path));
}
