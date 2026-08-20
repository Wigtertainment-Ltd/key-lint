import { normalizePath } from './path.util.js';

export function escapeRegex(text: string): string {
	// Match every regular-expression metacharacter that must be escaped when inserting literal text.
	return text.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

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

export function matchesAny(path: string, patterns: string[]): boolean {
	if (patterns.length === 0) {
		return false;
	}

	return patterns.some((pattern) => globToRegex(pattern).test(path));
}
