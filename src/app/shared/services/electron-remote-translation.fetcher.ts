import { IRemoteTranslationFetcher, IRemoteTranslationFetchRequest, IRemoteTranslationFetchResponse, RemoteTranslationError, RemoteTranslationErrorCode } from '@key-lint/core';
import { ElectronService } from './electron.service';

let scanSequence = 0;

function nextScanId(): string {
	scanSequence += 1;
	return `renderer-${Date.now().toString(36)}-${scanSequence.toString(36)}`;
}

const REMOTE_ERROR_CODES = new Set<RemoteTranslationErrorCode>([
	'remote-fetch-failed',
	'remote-http-error',
	'remote-timeout',
	'remote-redirect-error',
	'remote-response-too-large',
	'remote-request-limit',
	'remote-request-conflict',
	'remote-invalid-request',
	'remote-invalid-json',
	'remote-invalid-root'
]);

/** Narrow renderer adapter for the translation-only main-process IPC contract. */
export class ElectronRemoteTranslationFetcher implements IRemoteTranslationFetcher {
	private readonly scanId: string = nextScanId();
	private closed = false;

	constructor(private readonly electronService: ElectronService) { }

	async fetch(request: IRemoteTranslationFetchRequest): Promise<IRemoteTranslationFetchResponse> {
		if (this.closed) {
			throw new RemoteTranslationError('remote-invalid-request', 'Remote translation scan is already closed.');
		}
		const result = await this.electronService.fetchTranslationResource({
			scanId: this.scanId,
			method: 'GET',
			url: request.url,
			headers: { ...request.headers },
			timeoutMs: 15_000,
			maxRedirects: 3,
			maxResponseBytes: request.maxResponseBytes
		});
		if (!('error' in result)) {
			return result.value;
		}
		const code = REMOTE_ERROR_CODES.has(result.error.code as RemoteTranslationErrorCode)
			? result.error.code as RemoteTranslationErrorCode
			: 'remote-fetch-failed';
		throw new RemoteTranslationError(code, result.error.message);
	}

	async close(): Promise<void> {
		if (this.closed) {
			return;
		}
		this.closed = true;
		const result = await this.electronService.endTranslationScan(this.scanId);
		if ('error' in result) {
			throw new RemoteTranslationError('remote-fetch-failed', result.error.message);
		}
	}
}
