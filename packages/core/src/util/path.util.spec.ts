import { describe, expect, it } from 'vitest';

import { normalizePath, pathDedupeKey } from './path.util.js';

describe('normalizePath', (): void => {
	it('trims paths, converts separators and collapses duplicate separators', (): void => {
		expect(normalizePath('  C:\\projects\\key-lint//src  ')).toBe('C:/projects/key-lint/src');
	});

	it('removes trailing separators from non-root paths', (): void => {
		expect(normalizePath('C:\\projects\\key-lint\\')).toBe('C:/projects/key-lint');
		expect(normalizePath('/projects/key-lint/')).toBe('/projects/key-lint');
	});

	it('preserves filesystem roots', (): void => {
		expect(normalizePath('C:\\')).toBe('C:/');
		expect(normalizePath('/')).toBe('/');
	});
});

describe('pathDedupeKey', (): void => {
	it('normalizes casing and separators for path comparisons', (): void => {
		expect(pathDedupeKey(' C:\\Projects\\Key-Lint\\ ')).toBe('c:/projects/key-lint');
	});
});
