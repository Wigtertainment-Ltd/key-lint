const { readFile } = require('node:fs/promises');

const COMMENT_MARKER = '<!-- keylint-report -->';
const PIPELINE_MARKER = '<!-- keylint-pipeline ';

async function updateMrComment({ env = process.env, fetchApi = fetch, read = readFile, log = console.log } = {}) {
	if (env.KEYLINT_MR_COMMENT === undefined || env.KEYLINT_MR_COMMENT === 'false') {
		return;
	}
	if (env.KEYLINT_MR_COMMENT !== 'true') {
		throw new Error("KeyLint: KEYLINT_MR_COMMENT must be 'true' or 'false'.");
	}
	if (env.CI_PIPELINE_SOURCE !== 'merge_request_event' || !env.CI_MERGE_REQUEST_IID || !['0', '1'].includes(env.KEYLINT_EXIT_CODE)) {
		return;
	}
	if (env.CI_MERGE_REQUEST_SOURCE_PROJECT_ID !== env.CI_PROJECT_ID || env.CI_MERGE_REQUEST_TARGET_PROJECT_ID !== env.CI_PROJECT_ID) {
		log('KeyLint: skipping MR comment for a fork. Reports remain available in the job.');
		return;
	}
	if (!env.KEYLINT_GITLAB_TOKEN) {
		log('KeyLint warning: skipping MR comment because KEYLINT_GITLAB_TOKEN is unavailable.');
		return;
	}

	let report;
	try {
		report = JSON.parse(await read(env.KEYLINT_JSON_REPORT || 'keylint-report/keylint.json', 'utf8'));
	} catch (error) {
		if (error.code !== 'ENOENT') {
			throw error;
		}
		log('KeyLint: skipping MR comment because no report was generated.');
		return;
	}
	const { error: errors, warning: warnings } = report.severityCounts;
	if (![errors, warnings].every((count) => Number.isSafeInteger(count) && count >= 0)) {
		throw new Error('KeyLint: report contains invalid severity counts.');
	}

	const mrPath = `/projects/${encodeURIComponent(env.CI_PROJECT_ID)}/merge_requests/${encodeURIComponent(env.CI_MERGE_REQUEST_IID)}`;
	const pipelineId = Number(env.CI_PIPELINE_ID);
	const jobId = Number(env.CI_JOB_ID);
	const body = [
		COMMENT_MARKER,
		`${PIPELINE_MARKER}${pipelineId} ${jobId} -->`,
		'## KeyLint',
		'',
		`**Result:** ${env.KEYLINT_EXIT_CODE === '0' ? 'passed' : 'failed'}`,
		'',
		'| Metric | Count |',
		'| --- | ---: |',
		`| Errors | ${errors} |`,
		`| Warnings | ${warnings} |`,
		'',
		`[Full report and artifacts](${env.CI_JOB_URL})`
	].join('\n');

	async function request(path, method = 'GET', payload) {
		const response = await fetchApi(`${env.CI_API_V4_URL}${path}`, {
			method,
			redirect: 'error',
			signal: AbortSignal.timeout(30000),
			headers: { 'PRIVATE-TOKEN': env.KEYLINT_GITLAB_TOKEN, 'Content-Type': 'application/json' },
			body: payload === undefined ? undefined : JSON.stringify(payload)
		});
		if (!response.ok) {
			const error = new Error(`KeyLint: GitLab comment request failed (HTTP ${response.status}).`);
			error.status = response.status;
			throw error;
		}
		return response.json();
	}

	try {
		const user = await request('/user');
		let note;
		for (let page = 1; ; page += 1) {
			const notes = await request(`${mrPath}/notes?per_page=100&page=${page}&sort=asc&order_by=created_at`);
			note = notes.find((entry) => entry.author?.id === user.id && !entry.system && entry.body?.startsWith(`${COMMENT_MARKER}\n`));
			if (note || notes.length < 100) {
				break;
			}
		}

		const previousPipeline = note?.body
			.split('\n')
			.find((line) => line.startsWith(PIPELINE_MARKER))
			?.slice(PIPELINE_MARKER.length)
			.split(' ');
		if (Number(previousPipeline?.[0]) > pipelineId || (Number(previousPipeline?.[0]) === pipelineId && Number(previousPipeline?.[1]) > jobId)) {
			log('KeyLint: skipping an older pipeline or job retry.');
			return;
		}
		const currentMr = await request(mrPath);
		const sourceSha = env.CI_MERGE_REQUEST_SOURCE_BRANCH_SHA || env.CI_COMMIT_SHA;
		if (currentMr.state !== 'opened' || currentMr.sha !== sourceSha) {
			log('KeyLint: skipping a closed or outdated merge request run.');
			return;
		}

		await request(note ? `${mrPath}/notes/${note.id}` : `${mrPath}/notes`, note ? 'PUT' : 'POST', { body });
	} catch (error) {
		if (![401, 403].includes(error.status)) {
			throw error;
		}
		log('KeyLint warning: MR comment unavailable. Check the API scope and project access of KEYLINT_GITLAB_TOKEN.');
	}
}

if (require.main === module) {
	updateMrComment().catch(() => {
		// API responses and exception messages can contain credentials or private report data.
		console.error('KeyLint: could not publish the merge request comment.');
		process.exitCode = 1;
	});
}

module.exports = { updateMrComment };
