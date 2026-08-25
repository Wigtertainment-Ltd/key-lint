import {
	IAutoHttpTranslationSourceConfig, IFilesystemTranslationSourceConfig, IHttpTranslationSourceConfig, IScannerConfig, IScannerConfigOverrides, IScannerGuardrails, ITranslationSourceConfig, ScannerConfigError
} from './config.interfaces.js';
import { DEFAULT_SCANNER_CONFIG } from './scanner-defaults.js';

const STRING_ARRAY_KEYS = ['includeTranslationGlobs', 'includeSourceGlobs', 'excludeGlobs', 'supportedTranslationExtensions', 'ignoreKeys'] as const;
const GUARDRAIL_KEYS = ['maxFiles', 'maxFileSizeBytes'] as const;
const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const LOCALE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function assertNonEmptyString(value: unknown, key: string): string {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new ScannerConfigError(`"${key}" must be a non-empty string.`);
	}
	return value.trim();
}

function parseLocales(value: unknown, key: string): string[] {
	const locales: string[] = assertStringArray(value, key).map((locale) => locale.trim());
	if (locales.length === 0 || locales.some((locale) => !LOCALE_PATTERN.test(locale))) {
		throw new ScannerConfigError(`"${key}" must contain at least one valid non-empty locale.`);
	}
	if (new Set(locales).size !== locales.length) {
		throw new ScannerConfigError(`"${key}" must not contain duplicates.`);
	}
	return locales;
}

function parseHeadersFromEnv(value: unknown, key: string): Record<string, string> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new ScannerConfigError(`"${key}" must be an object.`);
	}
	const headersFromEnv: Record<string, string> = {};
	const normalizedHeaderNames: Set<string> = new Set<string>();
	for (const [headerName, environmentName] of Object.entries(value as Record<string, unknown>)) {
		if (!HTTP_HEADER_NAME_PATTERN.test(headerName)) {
			throw new ScannerConfigError(`Invalid HTTP header name "${headerName}".`);
		}
		const normalizedHeaderName: string = headerName.toLowerCase();
		if (normalizedHeaderNames.has(normalizedHeaderName)) {
			throw new ScannerConfigError(`Duplicate HTTP header name "${headerName}".`);
		}
		normalizedHeaderNames.add(normalizedHeaderName);
		headersFromEnv[headerName] = assertNonEmptyString(environmentName, `${key}.${headerName}`);
	}
	return headersFromEnv;
}

function parseHttpTranslationSource(source: Record<string, unknown>, index: number): IHttpTranslationSourceConfig {
	const allowedKeys: Set<string> = new Set(['type', 'id', 'urlTemplate', 'locales', 'headersFromEnv']);
	for (const key of Object.keys(source)) {
		if (!allowedKeys.has(key)) {
			throw new ScannerConfigError(
				`Unknown HTTP translation source key "${key}" at index ${index}. Allowed keys: ${[...allowedKeys].join(', ')}.`
			);
		}
	}

	const id: string = assertNonEmptyString(source['id'], `translationSources[${index}].id`);
	const urlTemplate: string = assertNonEmptyString(source['urlTemplate'], `translationSources[${index}].urlTemplate`);
	if ((urlTemplate.match(/\{locale\}/g) ?? []).length !== 1) {
		throw new ScannerConfigError(
			`"translationSources[${index}].urlTemplate" must contain exactly one "{locale}" placeholder.`
		);
	}
	let parsedUrl: URL;
	try {
		parsedUrl = new URL(urlTemplate.replace('{locale}', 'en'));
	} catch {
		throw new ScannerConfigError(`"translationSources[${index}].urlTemplate" must be a valid absolute HTTP(S) URL.`);
	}
	if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
		throw new ScannerConfigError(`"translationSources[${index}].urlTemplate" must use HTTP or HTTPS.`);
	}
	if (parsedUrl.username || parsedUrl.password) {
		throw new ScannerConfigError(`"translationSources[${index}].urlTemplate" must not contain URL credentials.`);
	}

	const locales: string[] = parseLocales(source['locales'], `translationSources[${index}].locales`);

	let headersFromEnv: Record<string, string> | undefined;
	if (source['headersFromEnv'] !== undefined) {
		headersFromEnv = parseHeadersFromEnv(source['headersFromEnv'], `translationSources[${index}].headersFromEnv`);
	}

	return { type: 'http', id, urlTemplate, locales, ...(headersFromEnv ? { headersFromEnv } : {}) };
}

function parseAutoHttpTranslationSource(source: Record<string, unknown>, index: number): IAutoHttpTranslationSourceConfig {
	const allowedKeys = new Set(['type', 'id', 'origin', 'locales', 'headersFromEnv']);
	for (const key of Object.keys(source)) {
		if (!allowedKeys.has(key)) {
			throw new ScannerConfigError(
				`Unknown auto-http translation source key "${key}" at index ${index}. Allowed keys: ${[...allowedKeys].join(', ')}.`
			);
		}
	}
	const parsed: IAutoHttpTranslationSourceConfig = { type: 'auto-http' };
	if (source['id'] !== undefined) parsed.id = assertNonEmptyString(source['id'], `translationSources[${index}].id`);
	if (source['origin'] !== undefined) {
		const origin = assertNonEmptyString(source['origin'], `translationSources[${index}].origin`);
		let parsedOrigin: URL;
		try {
			parsedOrigin = new URL(origin);
		} catch {
			throw new ScannerConfigError(`"translationSources[${index}].origin" must be a valid absolute HTTP(S) origin.`);
		}
		if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.username || parsedOrigin.password ||
			parsedOrigin.pathname !== '/' || parsedOrigin.search || parsedOrigin.hash) {
			throw new ScannerConfigError(`"translationSources[${index}].origin" must be an HTTP(S) origin without credentials, path, query, or fragment.`);
		}
		parsed.origin = parsedOrigin.origin;
	}
	if (source['locales'] !== undefined) parsed.locales = parseLocales(source['locales'], `translationSources[${index}].locales`);
	if (source['headersFromEnv'] !== undefined) {
		parsed.headersFromEnv = parseHeadersFromEnv(source['headersFromEnv'], `translationSources[${index}].headersFromEnv`);
	}
	return parsed;
}

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
		if (source['type'] === 'http') {
			const parsed = parseHttpTranslationSource(source, index);
			if (identifiers.has(parsed.id)) {
				throw new ScannerConfigError(`Duplicate translation source id "${parsed.id}".`);
			}
			identifiers.add(parsed.id);
			return parsed;
		}
		if (source['type'] === 'auto-http') {
			const parsed = parseAutoHttpTranslationSource(source, index);
			const resolvedId = parsed.id ?? `auto-http-${index + 1}`;
			if (identifiers.has(resolvedId)) throw new ScannerConfigError(`Duplicate translation source id "${resolvedId}".`);
			identifiers.add(resolvedId);
			return parsed;
		}

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
				`"translationSources[${index}].type" must be "filesystem", "http", or "auto-http".`
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
