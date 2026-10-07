import { IHttpTranslationSourceConfig, IScannerGuardrails, ITranslationSourceConfig } from '../config/config.interfaces.js';
import { ITranslationResource } from '../models/translation-resource.model.js';
import { parseTranslationJson } from '../util/translation-json.util.js';
import { RemoteTranslationError, redactRemoteUrl } from './remote-translation.error.js';
import { DEFAULT_REMOTE_TRANSLATION_LIMITS, IRemoteTranslationFetchResponse, IRemoteTranslationRuntime } from './remote-translation.interfaces.js';

interface IPreparedHttpSource {
	source: IHttpTranslationSourceConfig;
	sourceIndex: number;
	headers: Record<string, string>;
	urls: string[];
}

/**
 * Creates a comparison signature from case-normalized, sorted header names and exact values.
 * The signature contains credential values and is intended only for in-memory request preflight.
 *
 * @param headers - Resolved HTTP header map.
 * @returns A stable signature independent of header insertion order and name casing.
 */
function headersSignature(headers: Readonly<Record<string, string>>): string {
	return Object.entries(headers)
		.map(([name, value]) => [name.toLowerCase(), value] as const)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([name, value]) => `${name}\u0000${value}`)
		.join('\u0001');
}

/**
 * Resolves environment headers and locale-specific URLs for explicit HTTP sources without fetching.
 * Non-HTTP sources are ignored, but each retained source keeps its original list index.
 *
 * @param sources - Ordered configuration sources to inspect.
 * @param runtime - Runtime environment supplying header values; defaults to an empty environment.
 * @returns HTTP sources with resolved headers and URLs ordered by their configured locales.
 * @throws {RemoteTranslationError} When a required environment variable is missing or empty.
 */
function prepareSources(sources: ITranslationSourceConfig[], runtime: IRemoteTranslationRuntime): IPreparedHttpSource[] {
	const environment: Readonly<Record<string, string | undefined>> = runtime.environment ?? {};
	const prepared: IPreparedHttpSource[] = [];

	for (const [sourceIndex, source] of sources.entries()) {
		if (source.type !== 'http') {
			continue;
		}

		const headers: Record<string, string> = {};
		for (const [headerName, environmentName] of Object.entries(source.headersFromEnv ?? {})) {
			const value = environment[environmentName];
			if (value === undefined || value.length === 0) {
				throw new RemoteTranslationError(
					'remote-environment-missing',
					`Remote translation source "${source.id}" requires environment variable "${environmentName}".`
				);
			}
			headers[headerName] = value;
		}

		prepared.push({
			source,
			sourceIndex,
			headers,
			urls: source.locales.map((locale) =>
				source.urlTemplate.replace('{locale}', encodeURIComponent(locale))
			)
		});
	}

	return prepared;
}

/**
 * Fetches every configured HTTP source after a complete preflight. The returned
 * map is keyed by source position so adapters can interleave local and remote
 * resources without changing configured merge order.
 * Checks consent, transport, environment values, conflicting headers, and the distinct-URL cap
 * before fetching. Identical URLs share a cached response during this collection call.
 * Resources are read-only and have placeholder position `0` for the adapter to assign later.
 *
 * @param sources - Ordered translation sources; only explicit HTTP sources are collected.
 * @param runtime - Explicit network consent, injected transport, and header environment.
 * @param guardrails - Scanner limits supplying the maximum response byte count.
 * @returns Resources grouped by original source index, with locale order preserved within each group.
 * @throws {RemoteTranslationError} When preflight fails or asynchronous transport fetching fails.
 * @throws {TranslationFileError} When a response is invalid JSON or lacks an object root.
 */
export async function collectRemoteTranslationResources(
	sources: ITranslationSourceConfig[],
	runtime: IRemoteTranslationRuntime,
	guardrails: IScannerGuardrails
): Promise<Map<number, ITranslationResource[]>> {
	if (!runtime.allowNetwork) {
		throw new RemoteTranslationError('network-not-allowed', 'Remote translation network access was not explicitly enabled.');
	}
	if (!runtime.fetcher) {
		throw new RemoteTranslationError('remote-fetcher-missing', 'Remote translation sources require an injected remote translation fetcher.');
	}

	const prepared: IPreparedHttpSource[] = prepareSources(sources, runtime);
	const requestSignatures: Map<string, string> = new Map<string, string>();
	for (const item of prepared) {
		const signature: string = headersSignature(item.headers);
		for (const url of item.urls) {
			const existingSignature: string | undefined = requestSignatures.get(url);
			if (existingSignature !== undefined && existingSignature !== signature) {
				throw new RemoteTranslationError('remote-request-conflict', `Remote translation URL ${redactRemoteUrl(url)} is configured with conflicting headers.`);
			}
			requestSignatures.set(url, signature);
		}
	}
	if (requestSignatures.size > DEFAULT_REMOTE_TRANSLATION_LIMITS.maxRequests) {
		throw new RemoteTranslationError(
			'remote-request-limit',
			`Remote translation scan requires ${requestSignatures.size} requests, exceeding the limit of ${DEFAULT_REMOTE_TRANSLATION_LIMITS.maxRequests}.`
		);
	}

	const responseCache: Map<string, Promise<IRemoteTranslationFetchResponse>> = new Map<string, Promise<IRemoteTranslationFetchResponse>>();
	const result: Map<number, ITranslationResource[]> = new Map<number, ITranslationResource[]>();
	for (const item of prepared) {
		const resources: ITranslationResource[] = [];
		for (const [resourceIndex, locale] of item.source.locales.entries()) {
			const url: string = item.urls[resourceIndex];
			let responsePromise: Promise<IRemoteTranslationFetchResponse> | undefined = responseCache.get(url);
			if (!responsePromise) {
				responsePromise = runtime.fetcher.fetch({
					url,
					headers: item.headers,
					timeoutMs: DEFAULT_REMOTE_TRANSLATION_LIMITS.timeoutMs,
					maxRedirects: DEFAULT_REMOTE_TRANSLATION_LIMITS.maxRedirects,
					maxResponseBytes: guardrails.maxFileSizeBytes
				});
				responseCache.set(url, responsePromise);
			}

			let response: IRemoteTranslationFetchResponse;
			try {
				response = await responsePromise;
			} catch (error) {
				if (error instanceof RemoteTranslationError) {
					throw error;
				}
				throw new RemoteTranslationError(
					'remote-fetch-failed',
					`Unable to fetch remote translation source "${item.source.id}" from ${redactRemoteUrl(url)}.`,
					{ cause: error }
				);
			}

			resources.push({
				locale,
				sourceType: 'http',
				sourceId: item.source.id,
				sourceIndex: item.sourceIndex,
				resourceIndex,
				position: 0,
				content: parseTranslationJson(response.body, redactRemoteUrl(response.finalUrl)),
				origin: { type: 'http', url: response.finalUrl },
				writable: false
			});
		}
		result.set(item.sourceIndex, resources);
	}

	return result;
}
