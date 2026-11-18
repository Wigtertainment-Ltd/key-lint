import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCliArgs, USAGE } from './args.js';
import { ICliIo } from './cli.interfaces.js';
import { runCli } from './cli.js';
import { publishPrComment } from './pr-comment.js';

type Provider = 'github' | 'gitlab';

interface IRecordedRequest {
	url: URL;
	method: string;
	options: RequestInit | undefined;
	body: string | undefined;
}

interface ITestNote {
	id: number;
	body: string;
	user?: { login: string };
	author?: { id: number };
	system?: boolean;
}

interface IScenario {
	env: NodeJS.ProcessEnv;
	calls: IRecordedRequest[];
	logs: string[];
	pages: ITestNote[][];
	current: { state: string; sha: string; head: { sha: string } };
	failureStatus?: number;
	failureMethod: string;
	networkError?: Error;
}

const providers: Provider[] = ['github', 'gitlab'];
const temporaryRoots: string[] = [];
const marker: string = '<!-- keylint-report -->';
const fixture: string = fileURLToPath(new URL('../test/fixtures/multi-locale', import.meta.url));

async function setup(provider: Provider, fork: boolean = false): Promise<IScenario> {
	const root: string = await mkdtemp(join(tmpdir(), 'keylint-ci-comment-'));
	temporaryRoots.push(root);
	const eventPath: string = join(root, 'event.json');
	await writeFile(eventPath, JSON.stringify({ pull_request: { number: 7, head: { sha: 'source-sha', repo: { full_name: fork ? 'fork/app' : 'example/app' } } } }));
	const env: NodeJS.ProcessEnv = provider === 'github' ? {
		GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: eventPath, GITHUB_REPOSITORY: 'example/app', GITHUB_TOKEN: 'test-token',
		GITHUB_API_URL: 'https://github.example/api/v3', GITHUB_SERVER_URL: 'https://github.example', GITHUB_WORKFLOW: 'i18n audit',
		GITHUB_RUN_ID: '1000', GITHUB_RUN_NUMBER: '20', GITHUB_RUN_ATTEMPT: '2'
	} : {
		CI_PIPELINE_SOURCE: 'merge_request_event', CI_API_V4_URL: 'https://gitlab.example/api/v4', CI_PROJECT_ID: '42', CI_MERGE_REQUEST_IID: '7',
		CI_MERGE_REQUEST_SOURCE_PROJECT_ID: fork ? '41' : '42', CI_MERGE_REQUEST_TARGET_PROJECT_ID: '42', CI_COMMIT_SHA: 'source-sha',
		CI_PIPELINE_ID: '20', CI_JOB_ID: '200', CI_JOB_URL: 'https://gitlab.example/example/app/-/jobs/200', KEYLINT_GITLAB_TOKEN: 'test-token'
	};
	const scenario: IScenario = {
		env, calls: [], logs: [], pages: [[]], current: { state: provider === 'github' ? 'open' : 'opened', sha: 'source-sha', head: { sha: 'source-sha' } }, failureMethod: 'GET'
	};
	vi.stubGlobal('fetch', vi.fn((input: string, options?: RequestInit): Promise<Response> => {
		const url: URL = new URL(input);
		const method: string = options?.method ?? 'GET';
		const payload: { body: string } | undefined = typeof options?.body === 'string' ? JSON.parse(options.body) as { body: string } : undefined;
		scenario.calls.push({ url, method, options, body: payload?.body });
		if (scenario.networkError) {
			return Promise.reject(scenario.networkError);
		}
		if (scenario.failureStatus && scenario.failureMethod === method) {
			return Promise.resolve(new Response('sensitive API response', { status: scenario.failureStatus }));
		}
		const page: number = Number(url.searchParams.get('page'));
		const result: unknown = method !== 'GET' ? {} : url.pathname.endsWith('/user') ? { id: 99 } : page ? scenario.pages[page - 1] ?? [] : scenario.current;
		return Promise.resolve(new Response(JSON.stringify(result), { status: 200 }));
	}));
	return scenario;
}

async function publish(scenario: IScenario, exitCode: number = 0): Promise<void> {
	await publishPrComment({ error: 3, warning: 2, info: 0 }, exitCode, (text: string): undefined => void scenario.logs.push(text), scenario.env);
}

function runMetadata(provider: Provider, run: number, attempt: number): string {
	return provider === 'github' ? `<!-- keylint-run i18n%20audit ${run} ${attempt} -->` : `<!-- keylint-pipeline ${run} ${attempt} -->`;
}

function ownedNote(id: number, body: string): ITestNote {
	return { id, body, user: { login: 'github-actions[bot]' }, author: { id: 99 } };
}

function activateEnvironment(scenario: IScenario): void {
	vi.stubEnv('GITHUB_EVENT_NAME', '');
	vi.stubEnv('CI_PIPELINE_SOURCE', '');
	for (const [name, value] of Object.entries(scenario.env)) {
		vi.stubEnv(name, value);
	}
}

function captureIo(out: string[], err: string[]): ICliIo {
	return {
		stdout: (text: string): undefined => void out.push(text),
		stderr: (text: string): undefined => void err.push(text),
		writeFile: (): Promise<void> => Promise.reject(new Error('Comments must not require report files.'))
	};
}

afterEach(async (): Promise<void> => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	for (const root of temporaryRoots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

it('requires the same explicit CLI opt-in for both platforms', (): void => {
	expect(parseCliArgs(['scan']).prComment).toBe(false);
	expect(parseCliArgs(['scan', '--pr-comment']).prComment).toBe(true);
	expect(USAGE).toContain('--pr-comment');
});

describe.each(providers)('%s native PR comment contract', (provider: Provider): void => {
	it.each([0, 1])('publishes directly from scan counts with status %s', async (exitCode: number): Promise<void> => {
		const scenario: IScenario = await setup(provider);
		await publish(scenario, exitCode);
		const posted: IRecordedRequest = scenario.calls.at(-1)!;
		expect(posted.method).toBe('POST');
		expect(posted.body).toContain(`**Result:** ${exitCode === 0 ? 'passed' : 'failed'}`);
		expect(posted.body).toContain('| Errors | 3 |');
		expect(posted.body).toContain('| Warnings | 2 |');
		expect(posted.body).toContain('Full report and artifacts');
		expect(posted.body).not.toContain('test-token');
		expect(posted.options?.redirect).toBe('error');
		expect(scenario.logs).toEqual([]);
	});

	it('updates the owned marked comment while ignoring other authors and unrelated comments', async (): Promise<void> => {
		const scenario: IScenario = await setup(provider);
		scenario.pages[0] = [
			{ id: 1, body: `${marker}\nCopied marker`, user: { login: 'contributor' }, author: { id: 1 } },
			ownedNote(2, 'Unrelated comment'), ownedNote(3, `${marker}\nPrevious result`)
		];
		await publish(scenario);
		const updated: IRecordedRequest = scenario.calls.at(-1)!;
		expect(updated.method).toBe(provider === 'github' ? 'PATCH' : 'PUT');
		expect(updated.url.pathname).toBe(provider === 'github' ? '/api/v3/repos/example/app/issues/comments/3' : '/api/v4/projects/42/merge_requests/7/notes/3');
	});

	it('paginates comments before deciding to create or update', async (): Promise<void> => {
		const scenario: IScenario = await setup(provider);
		scenario.pages = [Array.from({ length: 100 }, (): ITestNote => ownedNote(1, 'Unrelated')), [ownedNote(3, `${marker}\nPrevious`)]];
		await publish(scenario);
		expect(scenario.calls.some((call: IRecordedRequest): boolean => call.url.searchParams.get('page') === '2')).toBe(true);
		expect(scenario.calls.at(-1)?.method).toBe(provider === 'github' ? 'PATCH' : 'PUT');
	});

	it('skips forks without contacting an API', async (): Promise<void> => {
		const scenario: IScenario = await setup(provider, true);
		await publish(scenario);
		expect(scenario.calls).toEqual([]);
	});

	it('skips non-PR pipelines without contacting an API', async (): Promise<void> => {
		const scenario: IScenario = await setup(provider);
		if (provider === 'github') {
			scenario.env.GITHUB_EVENT_NAME = 'pull_request_target';
			scenario.env.GITHUB_EVENT_PATH = 'does-not-exist';
		} else {
			scenario.env.CI_PIPELINE_SOURCE = 'push';
		}
		await publish(scenario);
		expect(scenario.calls).toEqual([]);
	});

	it('warns and skips when the token is unavailable', async (): Promise<void> => {
		const scenario: IScenario = await setup(provider);
		scenario.env[provider === 'github' ? 'GITHUB_TOKEN' : 'KEYLINT_GITLAB_TOKEN'] = undefined;
		await publish(scenario);
		expect(scenario.calls).toEqual([]);
		expect(scenario.logs).toEqual(['KeyLint warning: PR comment unavailable. Check the CI token and its permission to write comments.\n']);
	});

	it.each([401, 403])('uses the same warning for HTTP %s on reads and writes', async (status: number): Promise<void> => {
		for (const method of ['GET', 'POST']) {
			const scenario: IScenario = await setup(provider);
			scenario.failureStatus = status;
			scenario.failureMethod = method;
			await publish(scenario);
			expect(scenario.logs).toEqual(['KeyLint warning: PR comment unavailable. Check the CI token and its permission to write comments.\n']);
		}
	});

	it.each(['stale', 'closed'])('skips %s pull requests before writing', async (state: string): Promise<void> => {
		const scenario: IScenario = await setup(provider);
		if (state === 'closed') {
			scenario.current.state = 'closed';
		} else {
			scenario.current.sha = 'new-sha';
			scenario.current.head.sha = 'new-sha';
		}
		await publish(scenario);
		expect(scenario.calls.every((call: IRecordedRequest): boolean => call.method === 'GET')).toBe(true);
	});

	it.each(['run', 'retry'])('does not overwrite a newer %s', async (kind: string): Promise<void> => {
		const scenario: IScenario = await setup(provider);
		const run: number = kind === 'run' ? 21 : 20;
		const attempt: number = provider === 'github' ? 3 : 201;
		scenario.pages[0] = [ownedNote(3, `${marker}\n${runMetadata(provider, run, attempt)}`)];
		await publish(scenario);
		expect(scenario.calls.every((call: IRecordedRequest): boolean => call.method === 'GET')).toBe(true);
		expect(scenario.calls.some((call: IRecordedRequest): boolean => call.url.pathname.endsWith(provider === 'github' ? '/pulls/7' : '/merge_requests/7'))).toBe(false);
	});

	it('updates an older run', async (): Promise<void> => {
		const scenario: IScenario = await setup(provider);
		scenario.pages[0] = [ownedNote(3, `${marker}\n${runMetadata(provider, 19, 999)}`)];
		await publish(scenario);
		expect(scenario.calls.at(-1)?.method).toBe(provider === 'github' ? 'PATCH' : 'PUT');
	});

	it.each([429, 500])('reports HTTP %s generically without reading the API error body', async (status: number): Promise<void> => {
		const scenario: IScenario = await setup(provider);
		scenario.failureStatus = status;
		await expect(publish(scenario)).rejects.toThrow('KeyLint: could not publish the pull request comment.');
		expect(scenario.logs).toEqual([]);
	});

	it('publishes from a normal CLI scan without --output or --allow-network', async (): Promise<void> => {
		const scenario: IScenario = await setup(provider);
		activateEnvironment(scenario);
		const out: string[] = [];
		const err: string[] = [];
		const exitCode: number = await runCli(['scan', fixture, '--quiet', '--reporter', 'json', '--pr-comment'], captureIo(out, err));
		expect(exitCode).toBe(1);
		expect(scenario.calls.at(-1)?.body).toContain('**Result:** failed');
		expect((): unknown => JSON.parse(out.join('')) as unknown).not.toThrow();
		const report: { severityCounts: { error: number; warning: number } } = JSON.parse(out.join('')) as { severityCounts: { error: number; warning: number } };
		expect(scenario.calls.at(-1)?.body).toContain(`| Errors | ${report.severityCounts.error} |`);
		expect(scenario.calls.at(-1)?.body).toContain(`| Warnings | ${report.severityCounts.warning} |`);
		expect(err).toEqual([]);
	});

	it('does not contact CI APIs or read the event when the option is disabled', async (): Promise<void> => {
		const scenario: IScenario = await setup(provider);
		scenario.env.GITHUB_EVENT_PATH = 'does-not-exist';
		activateEnvironment(scenario);
		const exitCode: number = await runCli(['scan', fixture, '--quiet', '--reporter', 'json'], captureIo([], []));
		expect(exitCode).toBe(1);
		expect(scenario.calls).toEqual([]);
	});

	it('does not publish after a scan runtime failure', async (): Promise<void> => {
		const scenario: IScenario = await setup(provider);
		activateEnvironment(scenario);
		const exitCode: number = await runCli(['scan', join(fixture, 'missing-project'), '--pr-comment'], captureIo([], []));
		expect(exitCode).toBe(2);
		expect(scenario.calls).toEqual([]);
	});

	it.each([false, true])('preserves threshold failure and returns runtime failure after a passed scan=%s', async (passing: boolean): Promise<void> => {
		const scenario: IScenario = await setup(provider);
		scenario.networkError = new Error('sensitive-token');
		activateEnvironment(scenario);
		const out: string[] = [];
		const err: string[] = [];
		const args: string[] = ['scan', fixture, '--quiet', '--reporter', 'json', '--pr-comment'];
		if (passing) {
			args.push('--max-errors', '999');
		}
		const exitCode: number = await runCli(args, captureIo(out, err));
		expect(exitCode).toBe(passing ? 2 : 1);
		expect(err).toEqual(['KeyLint: could not publish the pull request comment.\n']);
		expect(out.join('')).not.toContain('sensitive-token');
	});
});

it('formats identical status and metrics for GitHub and GitLab', async (): Promise<void> => {
	const bodies: string[][] = [];
	for (const provider of providers) {
		const scenario: IScenario = await setup(provider);
		await publish(scenario, 1);
		bodies.push(scenario.calls.at(-1)!.body!.split('\n').slice(2, -1));
	}
	expect(bodies[0]).toEqual(bodies[1]);
});

it('uses the source head for GitLab merged-results pipelines and skips parent-project fork pipelines', async (): Promise<void> => {
	const scenario: IScenario = await setup('gitlab');
	scenario.env.CI_COMMIT_SHA = 'synthetic-merge-sha';
	scenario.env.CI_MERGE_REQUEST_SOURCE_BRANCH_SHA = 'source-sha';
	await publish(scenario);
	expect(scenario.calls.at(-1)?.method).toBe('POST');
	scenario.calls.length = 0;
	scenario.env.CI_MERGE_REQUEST_TARGET_PROJECT_ID = '43';
	await publish(scenario);
	expect(scenario.calls).toEqual([]);
});
