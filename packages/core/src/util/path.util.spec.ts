import { describe, expect, it } from 'vitest';

import { normalizePath, pathDedupeKey } from './path.util.js';

describe('normalizePath', () => {
	it('trims paths, converts separators and collapses duplicate separators', () => {
		expect(normalizePath('  C:\\projects\\key-lint//src  ')).toBe('C:/projects/key-lint/src');
	});

	it('removes trailing separators from non-root paths', () => {
		expect(normalizePath('C:\\projects\\key-lint\\')).toBe('C:/projects/key-lint');
		expect(normalizePath('/projects/key-lint/')).toBe('/projects/key-lint');
	});

	it('preserves filesystem roots', () => {
		expect(normalizePath('C:\\')).toBe('C:/');
		expect(normalizePath('/')).toBe('/');
	});
});

describe('pathDedupeKey', () => {
	it('normalizes casing and separators for path comparisons', () => {
		expect(pathDedupeKey(' C:\\Projects\\Key-Lint\\ ')).toBe('c:/projects/key-lint');
	});
});
