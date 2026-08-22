import {
	IFilesystemTranslationSourceConfig,
	IScannerConfig,
	IScannerConfigOverrides,
	IScannerGuardrails,
	ITranslationSourceConfig,
	ScannerConfigError
} from './config.interfaces.js';
import { DEFAULT_SCANNER_CONFIG } from './scanner-defaults.js';

const STRING_ARRAY_KEYS = ['includeTranslationGlobs', 'includeSourceGlobs', 'excludeGlobs', 'supportedTranslationExtensions', 'ignoreKeys'] as const;
const GUARDRAIL_KEYS = ['maxFiles', 'maxFileSizeBytes'] as const;

function assertTranslationSources(value: unknown): ITranslationSourceConfig[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new ScannerConfigError('"translationSources" must be a non-empty array.');
	}

	const identifiers = new Set<string>();
	return value.map((entry, index) => {
		if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
			throw new ScannerConfigError(`"translationSources[${index}]" must be an object.`);
		}

		const source = entry as Record<string, unknown>;
		const allowedKeys = new Set(['type', 'id', 'includeGlobs']);
		for (const key of Object.keys(source)) {
			if (!allowedKeys.has(key)) {
				throw new ScannerConfigError(
					`Unknown translation source key "${key}" at index ${index}. Allowed keys: type, id, includeGlobs.`
				);
			}
		}

		if (source['type'] !== 'filesystem') {
			throw new ScannerConfigError(
				`"translationSources[${index}].type" must be "filesystem".`
			);
		}

		const parsed: IFilesystemTranslationSourceConfig = { type: 'filesystem' };
		if (source['id'] !== undefined) {
			if (typeof source['id'] !== 'string' || source['id'].trim().length === 0) {
				throw new ScannerConfigError(
					`"translationSources[${index}].id" must be a non-empty string.`
				);
			}
			parsed.id = source['id'].trim();
		}
		if (source['includeGlobs'] !== undefined) {
			const includeGlobs = assertStringArray(
				source['includeGlobs'],
				`translationSources[${index}].includeGlobs`
			);
			if (includeGlobs.length === 0 || includeGlobs.some((glob) => glob.trim().length === 0)) {
				throw new ScannerConfigError(
					`"translationSources[${index}].includeGlobs" must contain at least one non-empty glob.`
				);
			}
			parsed.includeGlobs = includeGlobs.map((glob) => glob.trim());
		}

		const resolvedId = parsed.id ?? `filesystem-${index + 1}`;
		if (identifiers.has(resolvedId)) {
			throw new ScannerConfigError(`Duplicate translation source id "${resolvedId}".`);
		}
		identifiers.add(resolvedId);
		return parsed;
	});
}

function assertStringArray(value: unknown, key: string): string[] {
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
		throw new ScannerConfigError(`"${key}" must be an array of strings.`);
	}

	return value as string[];
}

function assertPositiveInteger(value: unknown, key: string): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
		throw new ScannerConfigError(`"${key}" must be a positive integer.`);
	}

	return value;
}

/**
 * Validates a raw (e.g. JSON parsed) configuration object and rejects unknown
 * keys, so typos in a pipeline config fail loudly instead of being ignored.
 */
export function parseScannerConfigOverrides(raw: unknown): IScannerConfigOverrides {
	if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
		throw new ScannerConfigError('Configuration must be a JSON object.');
	}

	const source = raw as Record<string, unknown>;
	const allowedKeys = new Set<string>([
		...STRING_ARRAY_KEYS,
		'baseLocale',
		'guardrails',
		'translationSources'
	]);
	const overrides: IScannerConfigOverrides = {};

	for (const [key, value] of Object.entries(source)) {
		if (key === '$schema') {
			continue;
		}

		if (!allowedKeys.has(key)) {
			throw new ScannerConfigError(
				`Unknown configuration key "${key}". Allowed keys: ${[...allowedKeys].join(', ')}.`
			);
		}

		if (key === 'baseLocale') {
			if (typeof value !== 'string' || value.trim().length === 0) {
				throw new ScannerConfigError('"baseLocale" must be a non-empty string.');
			}

			overrides.baseLocale = value.trim();
			continue;
		}

		if (key === 'guardrails') {
			if (value === null || typeof value !== 'object' || Array.isArray(value)) {
				throw new ScannerConfigError('"guardrails" must be an object.');
			}

			const guardrails: Partial<IScannerGuardrails> = {};
			for (const [guardrailKey, guardrailValue] of Object.entries(value as Record<string, unknown>)) {
				if (!(GUARDRAIL_KEYS as readonly string[]).includes(guardrailKey)) {
					throw new ScannerConfigError(
						`Unknown guardrail "${guardrailKey}". Allowed: ${GUARDRAIL_KEYS.join(', ')}.`
					);
				}

				guardrails[guardrailKey as keyof IScannerGuardrails] = assertPositiveInteger(
					guardrailValue,
					`guardrails.${guardrailKey}`
				);
			}

			overrides.guardrails = guardrails;
			continue;
		}

		if (key === 'translationSources') {
			overrides.translationSources = assertTranslationSources(value);
			continue;
		}

		overrides[key as (typeof STRING_ARRAY_KEYS)[number]] = assertStringArray(value, key);
	}

	return overrides;
}

/** Merges overrides on top of a base config. Arrays are replaced, not concatenated. */
export function mergeScannerConfig(base: IScannerConfig = DEFAULT_SCANNER_CONFIG, overrides: IScannerConfigOverrides = {}): IScannerConfig {
	return {
		baseLocale: overrides.baseLocale ?? base.baseLocale,
		includeTranslationGlobs: overrides.includeTranslationGlobs ?? base.includeTranslationGlobs,
		includeSourceGlobs: overrides.includeSourceGlobs ?? base.includeSourceGlobs,
		excludeGlobs: overrides.excludeGlobs ?? base.excludeGlobs,
		supportedTranslationExtensions:
			overrides.supportedTranslationExtensions ?? base.supportedTranslationExtensions,
		translationSources: overrides.translationSources ?? base.translationSources,
		ignoreKeys: overrides.ignoreKeys ?? base.ignoreKeys,
		guardrails: {
			maxFiles: overrides.guardrails?.maxFiles ?? base.guardrails.maxFiles,
			maxFileSizeBytes: overrides.guardrails?.maxFileSizeBytes ?? base.guardrails.maxFileSizeBytes
		}
	};
}
