import { DesktopRemoteTranslationService } from './desktop-remote-translation.service';

describe('DesktopRemoteTranslationService', () => {
	let service: DesktopRemoteTranslationService;

	beforeEach(() => {
		service = new DesktopRemoteTranslationService();
	});

	it('loads configured sources in order and displays environment names without values', () => {
		service.loadConfiguredSources([
			{ type: 'filesystem', id: 'base', includeGlobs: ['src/i18n/*.json'] },
			{
				type: 'http',
				id: 'api',
				urlTemplate: 'https://example.com/{locale}.json',
				locales: ['de', 'en'],
				headersFromEnv: { Authorization: 'KEYLINT_AUTH' }
			}
		]);

		expect(service.sources.map((source) => source.id)).toEqual(['base', 'api']);
		expect(service.sources[1].headers[0]).toEqual(jasmine.objectContaining({
			name: 'Authorization',
			environmentName: 'KEYLINT_AUTH',
			value: ''
		}));
	});

	it('supports adding, editing, removing, and reordering workflow sources', () => {
		service.loadConfiguredSources([{ type: 'filesystem', id: 'base' }]);
		service.addHttpSource();
		const remote = service.sources[1];
		service.updateSource(remote.draftId, {
			id: 'feature',
			urlTemplate: 'https://example.com/{locale}.json',
			locales: ['en']
		});
		service.moveSource(remote.draftId, -1);

		expect(service.sources.map((source) => source.id)).toEqual(['feature', 'base']);
		service.removeSource(remote.draftId);
		expect(service.sources.map((source) => source.id)).toEqual(['base']);
	});

	it('validates source fields and temporary headers through the Core schema', () => {
		service.loadConfiguredSources([]);
		expect(service.validationError()).toContain('At least one');
		service.addHttpSource();
		const remote = service.sources[0];
		service.updateSource(remote.draftId, {
			id: 'api',
			urlTemplate: 'file:///{locale}.json',
			locales: ['en']
		});
		expect(service.validationError()).toContain('HTTP or HTTPS');

		service.updateSource(remote.draftId, { urlTemplate: 'https://example.com/{locale}.json' });
		service.addTemporaryHeader(remote.draftId);
		const header = service.sources[0].headers[0];
		service.updateHeader(remote.draftId, header.id, { name: 'Bad Header', value: 'secret' });
		expect(service.validationError()).toContain('invalid HTTP header name');
		service.updateHeader(remote.draftId, header.id, { name: 'Authorization', value: '' });
		expect(service.validationError()).toContain('temporary value');
	});

	it('builds a security summary without exposing header values', () => {
		service.loadConfiguredSources([{
			type: 'http',
			id: 'local-api',
			urlTemplate: 'http://127.0.0.1:3000/i18n/{locale}.json',
			locales: ['de', 'en'],
			headersFromEnv: { Authorization: 'KEYLINT_AUTH' }
		}]);
		const source = service.sources[0];
		service.updateHeader(source.draftId, source.headers[0].id, { value: 'Bearer very-secret' });

		const prepared = service.prepareScan();

		expect(prepared.confirmation.expectedRequestCount).toBe(2);
		expect(prepared.confirmation.hasInsecureHttp).toBeTrue();
		expect(prepared.confirmation.hasPrivateOrLocalTarget).toBeTrue();
		expect(prepared.confirmation.sources[0]).toEqual(jasmine.objectContaining({
			origin: 'http://127.0.0.1:3000',
			headerNames: ['Authorization'],
			headerEnvironmentNames: ['KEYLINT_AUTH']
		}));
		expect(JSON.stringify(prepared.confirmation)).not.toContain('very-secret');
		expect(prepared.environment['KEYLINT_AUTH']).toBe('Bearer very-secret');
	});

	it('clears temporary secrets on reset and clear without using persistent storage', () => {
		const storageSpy = spyOn(localStorage, 'setItem');
		service.loadConfiguredSources([{
			type: 'http', id: 'api', urlTemplate: 'https://example.com/{locale}.json', locales: ['en'],
			headersFromEnv: { Authorization: 'KEYLINT_AUTH' }
		}]);
		const source = service.sources[0];
		service.updateHeader(source.draftId, source.headers[0].id, { value: 'secret' });
		service.resetSources();
		expect(service.sources[0].headers[0].value).toBe('');
		service.updateHeader(service.sources[0].draftId, service.sources[0].headers[0].id, { value: 'secret-again' });
		service.clear();
		expect(service.sources).toEqual([]);
		expect(storageSpy).not.toHaveBeenCalled();
	});

	it('lists auto-http candidates and requires selection, origin, and locales before confirmation', async () => {
		service.loadConfiguredSources([{ type: 'auto-http' }]);
		const fs = {
			fileExists: async () => true,
			readFile: async () => 'source',
			listFiles: async () => ['C:/project/loader.ts']
		};
		await service.analyzeAutoSources('C:/project', fs, {
			includeSourceGlobs: ['**/*.ts'], excludeGlobs: [], includeTranslationGlobs: [],
			supportedTranslationExtensions: ['.json'], ignoreKeys: [], guardrails: { maxFiles: 10, maxFileSizeBytes: 1024 }
		}, async (files) => ({
			sourceFiles: files.map((file) => file.filePath),
			diagnostics: [{
				code: 'transloco-http-unsupported-scope', category: 'unsupported', message: 'Scoped loader',
				location: { filePath: 'C:/project/scope.ts', line: 2, column: 1, endLine: 2, endColumn: 5 }
			}],
			candidates: [
				{
					framework: 'ngx-translate', loader: 'http', api: 'provideTranslateHttpLoader', confidence: 'deterministic',
					resources: [{ urlTemplate: '/i18n/{locale}.json', urlKind: 'relative', requiresOrigin: true }], locales: ['en'],
					location: { filePath: 'C:/project/ngx.ts', line: 4, column: 2, endLine: 4, endColumn: 10 }
				},
				{
					framework: 'transloco', loader: 'http', api: 'TranslocoLoader', confidence: 'deterministic',
					resources: [{ urlTemplate: 'https://cdn.example/{locale}.json', urlKind: 'absolute', requiresOrigin: false }], locales: [],
					location: { filePath: 'C:/project/transloco.ts', line: 8, column: 2, endLine: 10, endColumn: 3 }
				}
			]
		}));

		const draft = service.sources[0];
		expect(draft.autoCandidates.map((candidate) => candidate.framework)).toEqual(['ngx-translate', 'transloco']);
		expect(draft.autoDiagnostics[0].code).toBe('transloco-http-unsupported-scope');
		expect(service.validationError()).toContain('Select one');
		service.selectAutoCandidate(draft.draftId, 0);
		expect(service.validationError()).toContain('requires an origin');
		service.updateSource(draft.draftId, { origin: 'https://app.example', locales: ['de'] });
		expect(service.validationError()).toBe('');

		const prepared = service.prepareScan();
		expect(prepared.translationSources).toEqual([{
			type: 'http', id: 'auto-http-1', urlTemplate: 'https://app.example/i18n/{locale}.json', locales: ['de']
		}]);
		expect(prepared.confirmation).toEqual(jasmine.objectContaining({ expectedRequestCount: 1 }));
	});
});
