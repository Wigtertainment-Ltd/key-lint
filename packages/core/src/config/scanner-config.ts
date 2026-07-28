import { DEFAULT_SCANNER_CONFIG, ScannerConfig, ScannerGuardrails } from './scanner-defaults.js';

export interface ScannerConfigOverrides {
	includeTranslationGlobs?: string[];
	includeSourceGlobs?: string[];
	excludeGlobs?: string[];
	supportedTranslationExtensions?: string[];
	ignoreKeys?: string[];
	guardrails?: Partial<ScannerGuardrails>;
}

export class ScannerConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ScannerConfigError';
	}
}

const STRING_ARRAY_KEYS = [
	'includeTranslationGlobs',
	'includeSourceGlobs',
	'excludeGlobs',
	'supportedTranslationExtensions',
	'ignoreKeys'
] as const;

const GUARDRAIL_KEYS = ['maxFiles', 'maxFileSizeBytes'] as const;

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
export function parseScannerConfigOverrides(raw: unknown): ScannerConfigOverrides {
	if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
		throw new ScannerConfigError('Configuration must be a JSON object.');
	}

	const source = raw as Record<string, unknown>;
	const allowedKeys = new Set<string>([...STRING_ARRAY_KEYS, 'guardrails']);
	const overrides: ScannerConfigOverrides = {};

	for (const [key, value] of Object.entries(source)) {
		if (key === '$schema') {
			continue;
		}

		if (!allowedKeys.has(key)) {
			throw new ScannerConfigError(
				`Unknown configuration key "${key}". Allowed keys: ${[...allowedKeys].join(', ')}.`
			);
		}

		if (key === 'guardrails') {
			if (value === null || typeof value !== 'object' || Array.isArray(value)) {
				throw new ScannerConfigError('"guardrails" must be an object.');
			}

			const guardrails: Partial<ScannerGuardrails> = {};
			for (const [guardrailKey, guardrailValue] of Object.entries(value as Record<string, unknown>)) {
				if (!(GUARDRAIL_KEYS as readonly string[]).includes(guardrailKey)) {
					throw new ScannerConfigError(
						`Unknown guardrail "${guardrailKey}". Allowed: ${GUARDRAIL_KEYS.join(', ')}.`
					);
				}

				guardrails[guardrailKey as keyof ScannerGuardrails] = assertPositiveInteger(
					guardrailValue,
					`guardrails.${guardrailKey}`
				);
			}

			overrides.guardrails = guardrails;
			continue;
		}

		overrides[key as (typeof STRING_ARRAY_KEYS)[number]] = assertStringArray(value, key);
	}

	return overrides;
}

/** Merges overrides on top of a base config. Arrays are replaced, not concatenated. */
export function mergeScannerConfig(
	base: ScannerConfig = DEFAULT_SCANNER_CONFIG,
	overrides: ScannerConfigOverrides = {}
): ScannerConfig {
	return {
		includeTranslationGlobs: overrides.includeTranslationGlobs ?? base.includeTranslationGlobs,
		includeSourceGlobs: overrides.includeSourceGlobs ?? base.includeSourceGlobs,
		excludeGlobs: overrides.excludeGlobs ?? base.excludeGlobs,
		supportedTranslationExtensions:
			overrides.supportedTranslationExtensions ?? base.supportedTranslationExtensions,
		ignoreKeys: overrides.ignoreKeys ?? base.ignoreKeys,
		guardrails: {
			maxFiles: overrides.guardrails?.maxFiles ?? base.guardrails.maxFiles,
			maxFileSizeBytes: overrides.guardrails?.maxFileSizeBytes ?? base.guardrails.maxFileSizeBytes
		}
	};
}
