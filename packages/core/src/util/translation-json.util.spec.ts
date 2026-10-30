import { describe, expect, it } from 'vitest';

import { IFileSystemAdapter } from '../adapters/scan-adapter.interface.js';
import {
	parseTranslationJson,
	readTranslationJson,
	TranslationFileError
} from './translation-json.util.js';

describe('translation JSON validation', (): void => {
	it('parses a translation object', (): void => {
		expect(parseTranslationJson('{"APP":{"TITLE":"Title"}}', 'translations/en.json')).toEqual({
			APP: { TITLE: 'Title' }
		});
	});

	it('rejects malformed JSON with its normalized file path', (): void => {
		// Match the complete normalized path while escaping regex-significant slashes and dots.
		expect((): Record<string, unknown> => parseTranslationJson('{"APP":', 'translations\\de.json')).toThrowError(
			/Invalid JSON in translation file "translations\/de\.json"/
		);

		try {
			parseTranslationJson('{"APP":', 'translations/de.json');
		} catch (error: unknown) {
			expect(error).toBeInstanceOf(TranslationFileError);
			expect((error as TranslationFileError).code).toBe('translation-file-invalid-json');
		}
	});

	it.each(['[]', 'null', '"text"'])('rejects a non-object root: %s', (raw: string): void => {
		expect((): Record<string, unknown> => parseTranslationJson(raw, 'translations/en.json')).toThrowError(
			'Translation file "translations/en.json" must contain a JSON object at the root.'
		);
	});

	it('wraps filesystem read errors with the affected file path', async (): Promise<void> => {
		const fs: IFileSystemAdapter = {
			readFile: (): Promise<never> => Promise.reject(new Error('Access denied'))
		} as unknown as IFileSystemAdapter;

		await expect(readTranslationJson(fs, 'translations/de.json')).rejects.toMatchObject({
			name: 'TranslationFileError',
			code: 'translation-file-unreadable',
			filePath: 'translations/de.json',
			message: 'Unable to read translation file "translations/de.json": Access denied'
		});
	});
});
