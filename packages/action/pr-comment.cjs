const { readFile } = require('node:fs/promises');

const COMMENT_MARKER = '<!-- keylint-report -->';
const RUN_MARKER = '<!-- keylint-run ';

async function updatePrComment({ env = process.env, fetchApi = fetch, read = readFile, log = console.log } = {}) {
	if (env.GITHUB_EVENT_NAME !== 'pull_request' || !['0', '1'].includes(env.KEYLINT_EXIT_CODE)) {
		return;
	}

	const event = JSON.parse(await read(env.GITHUB_EVENT_PATH, 'utf8'));
	const pullRequest = event.pull_request;
	if (pullRequest.head.repo?.full_name !== env.GITHUB_REPOSITORY) {
		log('KeyLint: skipping PR comment for a fork. Reports remain available in the workflow.');
		return;
	}
	if (!env.GITHUB_TOKEN) {
		log('::warning::KeyLint: skipping PR comment because the workflow token is unavailable.');
		return;
	}

	let report;
	try {
		report = JSON.parse(await read(env.KEYLINT_JSON_REPORT, 'utf8'));
	} catch (error) {
		if (error.code !== 'ENOENT') {
			throw error;
		}
		log('KeyLint: skipping PR comment because no report was generated.');
		return;
	}
	const { error: errors, warning: warnings } = report.severityCounts;
	if (![errors, warnings].every((count) => Number.isSafeInteger(count) && count >= 0)) {
		throw new Error('KeyLint: report contains invalid severity counts.');
	}

	const repository = env.GITHUB_REPOSITORY.split('/').map(encodeURIComponent).join('/');
	const basePath = `/repos/${repository}`;
	const issuePath = `${basePath}/issues/${pullRequest.number}/comments`;
	const workflow = encodeURIComponent(env.GITHUB_WORKFLOW);
	const runNumber = Number(env.GITHUB_RUN_NUMBER);
	const attempt = Number(env.GITHUB_RUN_ATTEMPT);
	const body = [
		COMMENT_MARKER,
		`${RUN_MARKER}${workflow} ${runNumber} ${attempt} -->`,
		'## KeyLint',
		'',
		`**Result:** ${env.KEYLINT_EXIT_CODE === '0' ? 'passed' : 'failed'}`,
		'',
		'| Metric | Count |',
		'| --- | ---: |',
		`| Errors | ${errors} |`,
		`| Warnings | ${warnings} |`,
		'',
		`[Full report and artifacts](${env.GITHUB_SERVER_URL}/${repository}/actions/runs/${env.GITHUB_RUN_ID})`
	].join('\n');

	async function request(path, method = 'GET', payload) {
		const response = await fetchApi(`${env.GITHUB_API_URL}${path}`, {
			method,
			redirect: 'error',
			signal: AbortSignal.timeout(30000),
			headers: {
				Accept: 'application/vnd.github+json',
				Authorization: `Bearer ${env.GITHUB_TOKEN}`,
				'Content-Type': 'application/json',
				'X-GitHub-Api-Version': '2022-11-28'
			},
			body: payload === undefined ? undefined : JSON.stringify(payload)
		});
		if (!response.ok) {
			const error = new Error(`KeyLint: GitHub comment request failed (HTTP ${response.status}).`);
			error.status = response.status;
			throw error;
		}
		return response.json();
	}

	try {
		let comment;
		for (let page = 1; ; page += 1) {
			const comments = await request(`${issuePath}?per_page=100&page=${page}`);
			comment = comments.find((entry) => entry.user?.login === 'github-actions[bot]' && entry.body?.startsWith(`${COMMENT_MARKER}\n`));
			if (comment || comments.length < 100) {
				break;
			}
		}

		const previousRun = comment?.body
			.split('\n')
			.find((line) => line.startsWith(RUN_MARKER))
			?.slice(RUN_MARKER.length)
			.split(' ');
		if (previousRun?.[0] === workflow && (Number(previousRun[1]) > runNumber || (Number(previousRun[1]) === runNumber && Number(previousRun[2]) > attempt))) {
			log('KeyLint: skipping an older workflow run.');
			return;
		}
		const currentPr = await request(`${basePath}/pulls/${pullRequest.number}`);
		if (currentPr.state !== 'open' || currentPr.head.sha !== pullRequest.head.sha) {
			log('KeyLint: skipping a closed or outdated pull request run.');
			return;
		}

		await request(comment ? `${basePath}/issues/comments/${comment.id}` : issuePath, comment ? 'PATCH' : 'POST', { body });
	} catch (error) {
		if (![401, 403].includes(error.status)) {
			throw error;
		}
		log('::warning::KeyLint: PR comment unavailable. Check pull-requests: write permission on the workflow token.');
	}
}

if (require.main === module) {
	updatePrComment().catch(() => {
		// API responses and exception messages can contain credentials or private report data.
		console.error('KeyLint: could not publish the pull request comment.');
		process.exitCode = 1;
	});
}

module.exports = { updatePrComment };
