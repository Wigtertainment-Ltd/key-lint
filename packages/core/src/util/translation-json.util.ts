import type { IFileSystemAdapter } from '../adapters/scan-adapter.interface.js';
import { normalizePath } from './path.util.js';

export type TranslationFileErrorCode =
	| 'translation-file-unreadable'
	| 'translation-file-invalid-json'
	| 'translation-file-invalid-root';

export class TranslationFileError extends Error {
	readonly filePath: string;
	readonly code: TranslationFileErrorCode;

	/**
	 * Creates a categorized translation-file error with a normalized filesystem path.
	 *
	 * @param code - Machine-readable failure category.
	 * @param filePath - Translation location, normalized using filesystem path rules.
	 * @param message - Human-readable failure description.
	 * @param options - Standard error options, such as the original failure as `cause`.
	 */
	constructor(code: TranslationFileErrorCode, filePath: string, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'TranslationFileError';
		this.code = code;
		this.filePath = normalizePath(filePath);
	}
}

/**
 * Preserves HTTP(S) locations while normalizing filesystem translation paths.
 *
 * @param value - Translation file path or HTTP(S) URL.
 * @returns The unchanged HTTP(S) location or a normalized filesystem path.
 */
function normalizeTranslationLocation(value: string): string {
	return /^https?:\/\//i.test(value) ? value : normalizePath(value);
}

/**
 * Converts an arbitrary caught value into diagnostic text.
 *
 * @param error - Error instance or other thrown value.
 * @returns An error message, or the string representation of a non-error value.
 */
function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Parses translation JSON and requires a non-null, non-array object at its root.
 * Nested values are left unchanged and are not required to be strings.
 *
 * @param raw - JSON content to parse.
 * @param filePath - Filesystem path or HTTP(S) location used in diagnostics.
 * @returns The parsed translation object.
 * @throws {TranslationFileError} When JSON syntax is invalid or the root is not an object.
 */
export function parseTranslationJson(raw: string, filePath: string): Record<string, unknown> {
	const normalizedFilePath = normalizeTranslationLocation(filePath);
	let parsed: unknown;

	try {
		parsed = JSON.parse(raw) as unknown;
	} catch (error) {
		throw new TranslationFileError(
			'translation-file-invalid-json',
			normalizedFilePath,
			`Invalid JSON in translation file "${normalizedFilePath}": ${errorMessage(error)}`,
			{ cause: error }
		);
	}

	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new TranslationFileError(
			'translation-file-invalid-root',
			normalizedFilePath,
			`Translation file "${normalizedFilePath}" must contain a JSON object at the root.`
		);
	}

	return parsed as Record<string, unknown>;
}

/**
 * Reads a translation file through the supplied adapter and validates its JSON root.
 * The original path is passed to the adapter; diagnostics use its normalized form.
 *
 * @param fs - Filesystem adapter responsible for reading the content.
 * @param filePath - Translation file path to read.
 * @returns A promise resolving to the parsed translation object.
 * @throws {TranslationFileError} When reading fails, JSON is invalid, or the root is not an object.
 */
export async function readTranslationJson(
	fs: IFileSystemAdapter,
	filePath: string
): Promise<Record<string, unknown>> {
	const normalizedFilePath = normalizePath(filePath);
	let raw: string;

	try {
		raw = await fs.readFile(filePath);
	} catch (error) {
		throw new TranslationFileError(
			'translation-file-unreadable',
			normalizedFilePath,
			`Unable to read translation file "${normalizedFilePath}": ${errorMessage(error)}`,
			{ cause: error }
		);
	}

	return parseTranslationJson(raw, normalizedFilePath);
}

/**
 * Sets a dotted translation key in place, creating intermediate objects as needed.
 * Trims and skips empty path segments; replaces intermediate arrays, nulls, and non-object values.
 * A key without non-empty segments leaves the target unchanged.
 *
 * @param target - Translation object to mutate.
 * @param key - Dot-separated property path.
 * @param value - String assigned to the final property, replacing any existing value.
 */
export function setNestedTranslationKey(target: Record<string, unknown>, key: string, value: string): void {
	const segments = key.split('.').map((segment) => segment.trim()).filter(Boolean);
	if (!segments.length) {
		return;
	}

	let cursor: Record<string, unknown> = target;
	for (let i = 0; i < segments.length - 1; i += 1) {
		const segment = segments[i];
		const current = cursor[segment];
		if (current === null || typeof current !== 'object' || Array.isArray(current)) {
			cursor[segment] = {};
		}

		cursor = cursor[segment] as Record<string, unknown>;
	}

	cursor[segments.at(-1) as string] = value;
}
