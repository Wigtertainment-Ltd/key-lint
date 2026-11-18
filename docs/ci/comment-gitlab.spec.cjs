const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { readFile, mkdtemp, rm } = require('node:fs/promises');
const { resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
const { updateMrComment } = require('./comment-gitlab.cjs');

const marker = '<!-- keylint-report -->';

function setup({ env: overrides, report: reportOverride, notes = [], responses = [] } = {}) {
	const env = {
		KEYLINT_MR_COMMENT: 'true',
		KEYLINT_GITLAB_TOKEN: 'test-token',
		KEYLINT_EXIT_CODE: '0',
		CI_API_V4_URL: 'https://gitlab.example/api/v4',
		CI_PIPELINE_SOURCE: 'merge_request_event',
		CI_PROJECT_ID: '42',
		CI_MERGE_REQUEST_IID: '7',
		CI_MERGE_REQUEST_SOURCE_PROJECT_ID: '42',
		CI_MERGE_REQUEST_TARGET_PROJECT_ID: '42',
		CI_COMMIT_SHA: 'source-sha',
		CI_PIPELINE_ID: '20',
		CI_JOB_ID: '200',
		CI_JOB_URL: 'https://gitlab.example/example/project/-/jobs/200',
		...overrides
	};
	const calls = [];
	const reads = [];
	const logs = [];
	return {
		calls,
		reads,
		logs,
		options: {
			env,
			read: async (path) => {
				reads.push(path);
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
						json: async () =>
							options.method !== 'GET' ? {} : url.endsWith('/user') ? { id: 99 } : url.includes('/notes?') ? notes : { state: 'opened', sha: 'source-sha' }
					}
				);
			},
			log: (message) => logs.push(message)
		}
	};
}

test('creates a compact MR note with a job link without exposing finding content', async () => {
	const { calls, reads, options } = setup({ report: { severityCounts: { error: 2, warning: 3 }, findings: [{ key: 'PRIVATE_KEY', snippet: 'PRIVATE_SNIPPET' }] } });
	await updateMrComment(options);
	const posted = calls.at(-1);
	assert.equal(posted.method, 'POST');
	assert.equal(posted.url, 'https://gitlab.example/api/v4/projects/42/merge_requests/7/notes');
	assert.ok(posted.payload.body.startsWith(`${marker}\n<!-- keylint-pipeline 20 200 -->`));
	assert.ok(posted.payload.body.includes('**Result:** passed'));
	assert.ok(posted.payload.body.includes('| Errors | 2 |'));
	assert.ok(posted.payload.body.includes('| Warnings | 3 |'));
	assert.ok(posted.payload.body.includes('https://gitlab.example/example/project/-/jobs/200'));
	assert.ok(!posted.payload.body.includes('PRIVATE_'));
	assert.equal(posted.headers['PRIVATE-TOKEN'], 'test-token');
	assert.equal(posted.redirect, 'error');
	assert.deepEqual(reads, ['keylint-report/keylint.json']);
});

test('publishes threshold failures and accepts a custom report path', async () => {
	const { calls, reads, options } = setup({ env: { KEYLINT_EXIT_CODE: '1', KEYLINT_JSON_REPORT: 'custom/report.json' } });
	await updateMrComment(options);
	assert.ok(calls.at(-1).payload.body.includes('**Result:** failed'));
	assert.deepEqual(reads, ['custom/report.json']);
});

test('updates only the marked nonsystem note owned by the token user', async () => {
	const notes = [
		{ id: 1, author: { id: 1 }, body: `${marker}\nCopied marker` },
		{ id: 2, author: { id: 99 }, body: 'Unrelated comment' },
		{ id: 3, author: { id: 99 }, system: true, body: `${marker}\nSystem note` },
		{ id: 4, author: { id: 99 }, body: `${marker}\nPrevious report` }
	];
	const { calls, options } = setup({ notes });
	await updateMrComment(options);
	assert.equal(calls[0].url, 'https://gitlab.example/api/v4/user');
	assert.equal(calls.at(-1).method, 'PUT');
	assert.equal(calls.at(-1).url, 'https://gitlab.example/api/v4/projects/42/merge_requests/7/notes/4');
});

test('finds existing notes beyond the first page in stable creation order', async () => {
	const unrelated = Array.from({ length: 100 }, () => ({ author: { id: 1 }, body: 'Unrelated' }));
	const { calls, options } = setup({
		responses: [
			{ ok: true, json: async () => ({ id: 99 }) },
			{ ok: true, json: async () => unrelated },
			{ ok: true, json: async () => [{ id: 4, author: { id: 99 }, body: `${marker}\nPrevious report` }] }
		]
	});
	await updateMrComment(options);
	assert.ok(calls[2].url.endsWith('per_page=100&page=2&sort=asc&order_by=created_at'));
	assert.equal(calls.at(-1).method, 'PUT');
});

test('requires explicit opt-in and rejects invalid option values', async () => {
	for (const value of [undefined, 'false']) {
		const { calls, reads, options } = setup({ env: { KEYLINT_MR_COMMENT: value } });
		await updateMrComment(options);
		assert.equal(calls.length, 0);
		assert.equal(reads.length, 0);
	}
	const { options } = setup({ env: { KEYLINT_MR_COMMENT: 'yes' } });
	await assert.rejects(() => updateMrComment(options), { message: "KeyLint: KEYLINT_MR_COMMENT must be 'true' or 'false'." });
});

test('skips non-MR pipelines, missing MR IDs and runtime scan failures before reading reports', async () => {
	for (const env of [{ CI_PIPELINE_SOURCE: 'push' }, { CI_PIPELINE_SOURCE: 'web' }, { CI_MERGE_REQUEST_IID: '' }, { KEYLINT_EXIT_CODE: '2' }, { KEYLINT_EXIT_CODE: '' }]) {
		const { calls, reads, options } = setup({ env });
		await updateMrComment(options);
		assert.equal(calls.length, 0);
		assert.equal(reads.length, 0);
	}
});

test('skips fork MRs in source and parent pipelines and missing project identities', async () => {
	for (const env of [{ CI_MERGE_REQUEST_TARGET_PROJECT_ID: '43' }, { CI_MERGE_REQUEST_SOURCE_PROJECT_ID: '43' }, { CI_MERGE_REQUEST_SOURCE_PROJECT_ID: undefined }]) {
		const { calls, reads, options } = setup({ env });
		await updateMrComment(options);
		assert.equal(calls.length, 0);
		assert.equal(reads.length, 0);
	}
});

test('skips missing tokens and never falls back to CI_JOB_TOKEN', async () => {
	const { calls, reads, logs, options } = setup({ env: { KEYLINT_GITLAB_TOKEN: '', CI_JOB_TOKEN: 'job-token' } });
	await updateMrComment(options);
	assert.equal(calls.length, 0);
	assert.equal(reads.length, 0);
	assert.ok(logs[0].startsWith('KeyLint warning:'));
});

test('skips missing reports but rejects malformed, unreadable or invalid report data', async () => {
	const missing = setup({ report: Object.assign(new Error('Missing'), { code: 'ENOENT' }) });
	await updateMrComment(missing.options);
	assert.equal(missing.calls.length, 0);
	for (const report of [new SyntaxError('Invalid JSON'), Object.assign(new Error('Denied'), { code: 'EACCES' }), { severityCounts: { error: -1, warning: 0 } }]) {
		const { calls, options } = setup({ report });
		await assert.rejects(() => updateMrComment(options));
		assert.equal(calls.length, 0);
	}
});

test('skips stale source commits and closed or merged MRs', async () => {
	for (const currentMr of [
		{ state: 'opened', sha: 'newer-sha' },
		{ state: 'closed', sha: 'source-sha' },
		{ state: 'merged', sha: 'source-sha' }
	]) {
		const { calls, options } = setup({
			responses: [
				{ ok: true, json: async () => ({ id: 99 }) },
				{ ok: true, json: async () => [] },
				{ ok: true, json: async () => currentMr }
			]
		});
		await updateMrComment(options);
		assert.ok(calls.every((call) => call.method === 'GET'));
	}
});

test('uses the source SHA for merged-results and merge-train pipelines', async () => {
	for (const eventType of ['merged_result', 'merge_train']) {
		const { calls, options } = setup({
			env: { CI_MERGE_REQUEST_EVENT_TYPE: eventType, CI_COMMIT_SHA: 'synthetic-merge-sha', CI_MERGE_REQUEST_SOURCE_BRANCH_SHA: 'source-sha' }
		});
		await updateMrComment(options);
		assert.equal(calls.at(-1).method, 'POST');
	}
});

test('does not overwrite a newer pipeline or a newer retry of the same job', async () => {
	for (const run of ['21 100', '20 201']) {
		const { calls, options } = setup({ notes: [{ id: 4, author: { id: 99 }, body: `${marker}\n<!-- keylint-pipeline ${run} -->` }] });
		await updateMrComment(options);
		assert.equal(calls.length, 2);
	}
});

test('updates results when the pipeline or job retry is newer', async () => {
	for (const run of ['19 999', '20 199']) {
		const { calls, options } = setup({ notes: [{ id: 4, author: { id: 99 }, body: `${marker}\n<!-- keylint-pipeline ${run} -->` }] });
		await updateMrComment(options);
		assert.equal(calls.at(-1).method, 'PUT');
	}
});

test('warns on authentication and permission failures on reads and writes without exposing responses', async () => {
	for (const status of [401, 403]) {
		for (const stage of [0, 3]) {
			const responses = [
				{ ok: true, json: async () => ({ id: 99 }) },
				{ ok: true, json: async () => [] },
				{ ok: true, json: async () => ({ state: 'opened', sha: 'source-sha' }) }
			].slice(0, stage);
			responses.push({ ok: false, status, json: async () => assert.fail('Must not read potentially sensitive API errors') });
			const { logs, options } = setup({ responses });
			await updateMrComment(options);
			assert.ok(logs[0].startsWith('KeyLint warning:'));
		}
	}
});

test('surfaces network, rate limit and server failures', async () => {
	for (const response of [new Error('Network error'), { ok: false, status: 429 }, { ok: false, status: 500 }]) {
		const { options } = setup({ responses: [response] });
		await assert.rejects(() => updateMrComment(options));
	}
});

test('keeps the GitLab CI example valid with MR rules, serialization and always-uploaded reports', async () => {
	const workflow = await readFile(resolve(__dirname, 'gitlab-ci.yml'), 'utf8');
	const prettier = await import('prettier');
	await assert.doesNotReject(() => prettier.format(workflow, { parser: 'yaml' }));
	assert.ok(workflow.includes("KEYLINT_MR_COMMENT: 'true'"));
	assert.ok(workflow.includes('resource_group: keylint-$CI_MERGE_REQUEST_IID'));
	assert.ok(workflow.includes('$CI_PIPELINE_SOURCE == "merge_request_event"'));
	assert.ok(workflow.includes('$CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS && $CI_PIPELINE_SOURCE == "push"'));
	assert.ok(workflow.includes('when: never'));
	assert.ok(workflow.includes('$CI_COMMIT_BRANCH || $CI_COMMIT_TAG'));
	assert.ok(workflow.includes('KEYLINT_EXIT_CODE="$scan_exit" node ./docs/ci/comment-gitlab.cjs'));
	assert.ok(workflow.includes('when: always'));
	assert.ok(!workflow.includes('allow_failure: true'));
});

test('runs the actual GitLab shell step after threshold failures and preserves scan and publication exit codes', async (context) => {
	const directory = await mkdtemp(resolve(tmpdir(), 'keylint-gitlab-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const workflow = (await readFile(resolve(__dirname, 'gitlab-ci.yml'), 'utf8')).replaceAll('\r\n', '\n');
	const script = workflow
		.split('  script:\n    - |\n')[1]
		.split('\n  artifacts:')[0]
		.split('\n')
		.map((line) => line.slice(6))
		.join('\n');
	const windowsGitBash = resolve(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe');
	const shell = process.platform === 'win32' && existsSync(windowsGitBash) ? windowsGitBash : 'sh';
	const mocks = `npx() { return "$MOCK_SCAN_EXIT"; }
node() {
  printf '%s' "$KEYLINT_EXIT_CODE" > comment-status
  return "$MOCK_COMMENT_EXIT"
}
`;
	for (const scanExit of [0, 1, 2]) {
		for (const commentExit of [0, 1]) {
			const result = spawnSync(shell, ['-c', 'set -e\n' + mocks + script], {
				cwd: directory,
				encoding: 'utf8',
				env: { ...process.env, MOCK_SCAN_EXIT: String(scanExit), MOCK_COMMENT_EXIT: String(commentExit) }
			});
			assert.equal(result.status, scanExit || commentExit, result.stderr);
			assert.equal(await readFile(resolve(directory, 'comment-status'), 'utf8'), String(scanExit));
		}
	}
});
