const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { readFile, mkdtemp, rm } = require('node:fs/promises');
const { resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
const { updatePrComment } = require('./pr-comment.cjs');

const marker = '<!-- keylint-report -->';

function setup({ env: overrides, event: eventOverrides, report: reportOverride, comments = [], responses = [] } = {}) {
	const env = {
		GITHUB_EVENT_NAME: 'pull_request',
		GITHUB_EVENT_PATH: 'event.json',
		GITHUB_REPOSITORY: 'example/project',
		GITHUB_TOKEN: 'test-token',
		GITHUB_API_URL: 'https://api.github.com',
		GITHUB_SERVER_URL: 'https://github.com',
		GITHUB_WORKFLOW: 'i18n audit',
		GITHUB_RUN_NUMBER: '20',
		GITHUB_RUN_ATTEMPT: '1',
		GITHUB_RUN_ID: '1234',
		KEYLINT_JSON_REPORT: 'report.json',
		KEYLINT_EXIT_CODE: '0',
		...overrides
	};
	const event = { pull_request: { number: 7, head: { sha: 'current-sha', repo: { full_name: env.GITHUB_REPOSITORY } } }, ...eventOverrides };
	const calls = [];
	const logs = [];
	return {
		calls,
		logs,
		options: {
			env,
			read: async (path) => {
				if (path === 'event.json') {
					return JSON.stringify(event);
				}
				if (reportOverride instanceof Error) {
					throw reportOverride;
				}
				return JSON.stringify(reportOverride ?? { severityCounts: { error: 2, warning: 3 } });
			},
			fetchApi: async (url, options) => {
				calls.push({ url, ...options, payload: options.body && JSON.parse(options.body) });
				const response = responses.shift();
				if (response instanceof Error) {
					throw response;
				}
				return (
					response ?? {
						ok: true,
						json: async () => (options.method !== 'GET' ? {} : url.includes('/pulls/') ? { state: 'open', head: { sha: 'current-sha' } } : comments)
					}
				);
			},
			log: (message) => logs.push(message)
		}
	};
}

test('creates a compact PR comment without publishing private finding content', async () => {
	const { calls, options } = setup({ report: { severityCounts: { error: 2, warning: 3 }, findings: [{ key: 'PRIVATE_KEY', snippet: 'PRIVATE_SNIPPET' }] } });
	await updatePrComment(options);
	const posted = calls.at(-1);
	assert.equal(posted.method, 'POST');
	assert.equal(posted.url, 'https://api.github.com/repos/example/project/issues/7/comments');
	assert.ok(posted.payload.body.startsWith(marker));
	assert.ok(posted.payload.body.includes('**Result:** passed'));
	assert.ok(posted.payload.body.includes('| Errors | 2 |'));
	assert.ok(posted.payload.body.includes('| Warnings | 3 |'));
	assert.ok(posted.payload.body.includes('https://github.com/example/project/actions/runs/1234'));
	assert.ok(!posted.payload.body.includes('PRIVATE_'));
	assert.equal(posted.headers.Authorization, 'Bearer test-token');
	assert.equal(posted.redirect, 'error');
});

test('publishes threshold failures with a failed result', async () => {
	const { calls, options } = setup({ env: { KEYLINT_EXIT_CODE: '1' } });
	await updatePrComment(options);
	assert.ok(calls.at(-1).payload.body.includes('**Result:** failed'));
});

test('updates only the marked comment owned by the GitHub Actions bot', async () => {
	const comments = [
		{ id: 1, user: { login: 'contributor' }, body: `${marker}\nCopied marker` },
		{ id: 2, user: { login: 'another[bot]' }, body: `${marker}\nAnother bot` },
		{ id: 3, user: { login: 'github-actions[bot]' }, body: 'Unrelated comment' },
		{ id: 4, user: { login: 'github-actions[bot]' }, body: `${marker}\nPrevious report` }
	];
	const { calls, options } = setup({ comments });
	await updatePrComment(options);
	assert.equal(calls.at(-1).method, 'PATCH');
	assert.equal(calls.at(-1).url, 'https://api.github.com/repos/example/project/issues/comments/4');
});

test('finds the existing comment beyond the first page', async () => {
	const unrelated = Array.from({ length: 100 }, () => ({ user: { login: 'contributor' }, body: 'Unrelated' }));
	const { calls, options } = setup({
		responses: [
			{ ok: true, json: async () => unrelated },
			{ ok: true, json: async () => [{ id: 4, user: { login: 'github-actions[bot]' }, body: `${marker}\nPrevious report` }] }
		]
	});
	await updatePrComment(options);
	assert.ok(calls[1].url.endsWith('per_page=100&page=2'));
	assert.equal(calls.at(-1).method, 'PATCH');
});

test('skips push events, privileged PR events and missing or failed scans without reading files', async () => {
	for (const env of [{ GITHUB_EVENT_NAME: 'push' }, { GITHUB_EVENT_NAME: 'pull_request_target' }, { KEYLINT_EXIT_CODE: '2' }, { KEYLINT_EXIT_CODE: '' }]) {
		const { calls, options } = setup({ env });
		options.read = async () => assert.fail('Must not read reports for this event or scan status');
		await updatePrComment(options);
		assert.equal(calls.length, 0);
	}
});

test('skips fork and deleted-fork PRs without contacting GitHub', async () => {
	for (const repo of [{ full_name: 'contributor/project' }, null]) {
		const { calls, options } = setup({ event: { pull_request: { head: { repo } } } });
		await updatePrComment(options);
		assert.equal(calls.length, 0);
	}
});

test('skips missing token and missing report without contacting GitHub', async () => {
	for (const overrides of [{ env: { GITHUB_TOKEN: '' } }, { report: Object.assign(new Error('Missing'), { code: 'ENOENT' }) }]) {
		const { calls, options } = setup(overrides);
		await updatePrComment(options);
		assert.equal(calls.length, 0);
	}
});

test('rejects malformed or unreadable reports instead of publishing success', async () => {
	for (const report of [new SyntaxError('Invalid JSON'), Object.assign(new Error('Denied'), { code: 'EACCES' }), { severityCounts: { error: -1, warning: 0 } }]) {
		const { calls, options } = setup({ report });
		await assert.rejects(() => updatePrComment(options));
		assert.equal(calls.length, 0);
	}
});

test('skips stale commits and closed PRs before posting', async () => {
	for (const currentPr of [
		{ state: 'open', head: { sha: 'newer-sha' } },
		{ state: 'closed', head: { sha: 'current-sha' } }
	]) {
		const { calls, options } = setup({
			responses: [
				{ ok: true, json: async () => [] },
				{ ok: true, json: async () => currentPr }
			]
		});
		await updatePrComment(options);
		assert.ok(calls.every((call) => call.method === 'GET'));
	}
});

test('does not overwrite a newer workflow run or attempt on the same commit', async () => {
	for (const run of ['21 1', '20 2']) {
		const { calls, options } = setup({ comments: [{ id: 4, user: { login: 'github-actions[bot]' }, body: `${marker}\n<!-- keylint-run i18n%20audit ${run} -->` }] });
		await updatePrComment(options);
		assert.equal(calls.length, 1);
	}
});

test('allows a newer attempt to update the same run', async () => {
	const { calls, options } = setup({
		env: { GITHUB_RUN_ATTEMPT: '2' },
		comments: [{ id: 4, user: { login: 'github-actions[bot]' }, body: `${marker}\n<!-- keylint-run i18n%20audit 20 1 -->` }]
	});
	await updatePrComment(options);
	assert.equal(calls.at(-1).method, 'PATCH');
});

test('warns for missing permissions on reads and writes without exposing API responses', async () => {
	for (const status of [401, 403]) {
		for (const responseCount of [0, 2]) {
			const responses = Array.from({ length: responseCount }, (_, index) => ({
				ok: true,
				json: async () => (index === 0 ? [] : { state: 'open', head: { sha: 'current-sha' } })
			}));
			responses.push({ ok: false, status, json: async () => assert.fail('Must not read a potentially sensitive error response') });
			const { logs, options } = setup({ responses });
			await updatePrComment(options);
			assert.ok(logs[0].startsWith('::warning::'));
		}
	}
});

test('surfaces network and server failures rather than claiming a published report', async () => {
	for (const response of [new Error('Network error'), { ok: false, status: 500 }]) {
		const { options } = setup({ responses: [response] });
		await assert.rejects(() => updatePrComment(options));
	}
});

test('uses the configured GitHub Enterprise server and API paths', async () => {
	const { calls, options } = setup({ env: { GITHUB_API_URL: 'https://github.example/api/v3', GITHUB_SERVER_URL: 'https://github.example' } });
	await updatePrComment(options);
	assert.ok(calls[0].url.startsWith('https://github.example/api/v3/repos/'));
	assert.ok(calls.at(-1).payload.body.includes('https://github.example/example/project/actions/runs/1234'));
});

test('wires opt-in comments after failed scans and documents write permissions and concurrency', async () => {
	const action = await readFile(resolve(__dirname, 'action.yml'), 'utf8');
	const workflow = await readFile(resolve(__dirname, '../../docs/ci/github-actions.yml'), 'utf8');
	const prettier = await import('prettier');
	await assert.doesNotReject(() => prettier.format(action, { parser: 'yaml' }));
	// Match the new input declaration through its opt-in default.
	assert.match(action, /pr-comment:\s*\r?\n\s+description:.*\r?\n\s+required: false\r?\n\s+default: 'false'/);
	assert.ok(action.includes("!cancelled() && inputs.pr-comment == 'true' && github.event_name == 'pull_request'"));
	assert.ok(action.includes('KEYLINT_EXIT_CODE: ${{ steps.scan.outputs.exit-code }}'));
	assert.ok(action.includes('GITHUB_TOKEN: ${{ github.token }}'));
	assert.ok(action.indexOf('Update KeyLint pull request comment') > action.lastIndexOf('exit "${exit_code}"'));
	assert.ok(workflow.includes('pull-requests: write'));
	assert.ok(workflow.includes("pr-comment: 'true'"));
	assert.ok(workflow.includes('concurrency:'));
	assert.ok(workflow.includes('cancel-in-progress: true'));
});

test('preserves real scan exit codes and exposes reports before the comment step', async (context) => {
	const directory = await mkdtemp(resolve(tmpdir(), 'keylint-action-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const action = (await readFile(resolve(__dirname, 'action.yml'), 'utf8')).replaceAll('\r\n', '\n');
	const scanScript = action
		.split('      run: |\n')[1]
		.split('\n    - name:')[0]
		.split('\n')
		.map((line) => line.slice(8))
		.join('\n');
	const windowsGitBash = resolve(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe');
	const shell = process.platform === 'win32' && existsSync(windowsGitBash) ? windowsGitBash : 'bash';
	const mockNpx = `npx() {
  printf '%s' '{"findings":[],"severityCounts":{"error":2,"warning":3}}' > "$INPUT_REPORT_DIRECTORY/keylint.json"
  printf '%s' '# KeyLint test report' > "$INPUT_REPORT_DIRECTORY/keylint.md"
  return "$MOCK_EXIT_CODE"
}
`;
	for (const exitCode of [0, 1, 2]) {
		const result = spawnSync(shell, ['-c', mockNpx + scanScript], {
			cwd: directory,
			encoding: 'utf8',
			env: {
				...process.env,
				INPUT_PR_COMMENT: 'true',
				INPUT_ALLOW_NETWORK: 'false',
				INPUT_PATH: '.',
				INPUT_CONFIG: '',
				INPUT_VERSION: 'latest',
				INPUT_MAX_ERRORS: '0',
				INPUT_MAX_WARNINGS: '',
				INPUT_IGNORE: '',
				INPUT_REPORT_DIRECTORY: `report-${exitCode}`,
				INPUT_JOB_SUMMARY: 'true',
				GITHUB_OUTPUT: `output-${exitCode}`,
				GITHUB_STEP_SUMMARY: `summary-${exitCode}`,
				MOCK_EXIT_CODE: String(exitCode)
			}
		});
		assert.equal(result.status, exitCode, result.stderr);
		const output = await readFile(resolve(directory, `output-${exitCode}`), 'utf8');
		assert.ok(output.includes(`exit-code=${exitCode}`));
		assert.ok(output.includes(`json-report=report-${exitCode}/keylint.json`));
		assert.equal(await readFile(resolve(directory, `summary-${exitCode}`), 'utf8'), '# KeyLint test report');
	}

	const invalidInput = spawnSync(shell, ['-c', 'npx() { exit 99; }\n' + scanScript], {
		cwd: directory,
		encoding: 'utf8',
		env: { ...process.env, INPUT_PR_COMMENT: 'yes' }
	});
	assert.equal(invalidInput.status, 2, invalidInput.stderr);
	assert.ok(invalidInput.stderr.includes("pr-comment must be 'true' or 'false'."));
});
