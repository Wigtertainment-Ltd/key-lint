import type { IFileSystemAdapter } from '../adapters/scan-adapter.interface.js';
import { normalizePath } from './path.util.js';

export type TranslationFileErrorCode =
	| 'translation-file-unreadable'
	| 'translation-file-invalid-json'
	| 'translation-file-invalid-root';

export class TranslationFileError extends Error {
	readonly filePath: string;
	readonly code: TranslationFileErrorCode;

	constructor(code: TranslationFileErrorCode, filePath: string, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'TranslationFileError';
		this.code = code;
		this.filePath = normalizePath(filePath);
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function parseTranslationJson(raw: string, filePath: string): Record<string, unknown> {
	const normalizedFilePath = normalizePath(filePath);
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
