import { normalizePath } from './path.util.js';

export function escapeRegex(text: string): string {
	return text.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

export function globToRegex(glob: string): RegExp {
	const normalized = normalizePath(glob);
	const escaped = escapeRegex(normalized)
		.replace(/\*\*\//g, '__DOUBLE_STAR_SLASH__')
		.replace(/\*\*/g, '__DOUBLE_STAR__')
		.replace(/\*/g, '[^/]*')
		.replace(/__DOUBLE_STAR_SLASH__/g, '(?:.*/)?')
		.replace(/__DOUBLE_STAR__/g, '.*');

	return new RegExp(`^${escaped}$`);
}

export function matchesAny(path: string, patterns: string[]): boolean {
	if (patterns.length === 0) {
		return false;
	}

	return patterns.some((pattern) => globToRegex(pattern).test(path));
}
