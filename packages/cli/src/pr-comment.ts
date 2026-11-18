import { readFile } from 'node:fs/promises';
import { ISeverityCounts } from './reporters/reporter.interfaces.js';

const COMMENT_MARKER: string = '<!-- keylint-report -->';
const AUTH_WARNING: string = 'KeyLint warning: PR comment unavailable. Check the CI token and its permission to write comments.\n';

interface ICiCommentContext {
	provider: 'github' | 'gitlab';
	apiUrl: string;
	token: string | undefined;
	parentPath: string;
	commentsPath: string;
	headSha: string;
	reportUrl: string;
	runScope: string;
	runNumber: number;
	attempt: number;
}

interface IGitHubEvent {
	pull_request: {
		number: number;
		head: { sha: string; repo: { full_name: string } | null };
	};
}

interface IComment {
	id: number;
	body: string;
	user?: { login: string };
	author?: { id: number };
	system?: boolean;
}

interface IPullRequest {
	state: string;
	sha?: string;
	head?: { sha: string };
}

class CommentApiError extends Error {
	constructor(readonly status: number) {
		super('CI comment request failed.');
	}
}

async function resolveContext(env: NodeJS.ProcessEnv): Promise<ICiCommentContext | undefined> {
	if (env.GITHUB_EVENT_NAME === 'pull_request') {
		const event: IGitHubEvent = JSON.parse(await readFile(env.GITHUB_EVENT_PATH ?? '', 'utf8')) as IGitHubEvent;
		if (event.pull_request.head.repo?.full_name !== env.GITHUB_REPOSITORY) {
			return undefined;
		}
		const repository: string = (env.GITHUB_REPOSITORY ?? '').split('/').map(encodeURIComponent).join('/');
		const basePath: string = `/repos/${repository}`;
		return {
			provider: 'github', apiUrl: env.GITHUB_API_URL ?? 'https://api.github.com', token: env.GITHUB_TOKEN,
			parentPath: `${basePath}/pulls/${event.pull_request.number}`, commentsPath: `${basePath}/issues/${event.pull_request.number}/comments`,
			headSha: event.pull_request.head.sha, reportUrl: `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${repository}/actions/runs/${env.GITHUB_RUN_ID}`,
			runScope: encodeURIComponent(env.GITHUB_WORKFLOW ?? ''), runNumber: Number(env.GITHUB_RUN_NUMBER), attempt: Number(env.GITHUB_RUN_ATTEMPT)
		};
	}
	if (env.CI_PIPELINE_SOURCE === 'merge_request_event' && env.CI_MERGE_REQUEST_IID && env.CI_PROJECT_ID &&
		env.CI_MERGE_REQUEST_SOURCE_PROJECT_ID === env.CI_PROJECT_ID && env.CI_MERGE_REQUEST_TARGET_PROJECT_ID === env.CI_PROJECT_ID) {
		const parentPath: string = `/projects/${encodeURIComponent(env.CI_PROJECT_ID)}/merge_requests/${encodeURIComponent(env.CI_MERGE_REQUEST_IID)}`;
		let sourceSha: string = env.CI_MERGE_REQUEST_SOURCE_BRANCH_SHA ?? '';
		if (sourceSha === '') {
			sourceSha = env.CI_COMMIT_SHA ?? '';
		}
		return {
			provider: 'gitlab', apiUrl: env.CI_API_V4_URL ?? '', token: env.KEYLINT_GITLAB_TOKEN,
			parentPath, commentsPath: `${parentPath}/notes`, headSha: sourceSha,
			reportUrl: env.CI_JOB_URL ?? '', runScope: '', runNumber: Number(env.CI_PIPELINE_ID), attempt: Number(env.CI_JOB_ID)
		};
	}
	return undefined;
}

async function request<T>(context: ICiCommentContext, path: string, method: string = 'GET', body?: string): Promise<T> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (context.provider === 'github') {
		headers.Authorization = `Bearer ${context.token}`;
		headers.Accept = 'application/vnd.github+json';
		headers['X-GitHub-Api-Version'] = '2022-11-28';
	} else {
		headers['PRIVATE-TOKEN'] = context.token ?? '';
	}
	const response: Response = await fetch(`${context.apiUrl}${path}`, {
		method, headers, redirect: 'error', signal: AbortSignal.timeout(30000), body: body === undefined ? undefined : JSON.stringify({ body })
	});
	if (!response.ok) {
		throw new CommentApiError(response.status);
	}
	return await response.json() as T;
}

function runMarker(context: ICiCommentContext): string {
	return context.provider === 'github' ? '<!-- keylint-run ' : '<!-- keylint-pipeline ';
}

function isNewerComment(comment: IComment, context: ICiCommentContext): boolean {
	const prefix: string = runMarker(context);
	const metadata: string[] | undefined = comment.body.split('\n').find((line: string): boolean => line.startsWith(prefix))?.slice(prefix.length).split(' ');
	if (!metadata || (context.provider === 'github' && metadata[0] !== context.runScope)) {
		return false;
	}
	const offset: number = context.provider === 'github' ? 1 : 0;
	const previousRun: number = Number(metadata[offset]);
	const previousAttempt: number = Number(metadata[offset + 1]);
	return previousRun > context.runNumber || (previousRun === context.runNumber && previousAttempt > context.attempt);
}

function formatComment(counts: ISeverityCounts, exitCode: number, context: ICiCommentContext): string {
	const scope: string = context.provider === 'github' ? `${context.runScope} ` : '';
	return [
		COMMENT_MARKER, `${runMarker(context)}${scope}${context.runNumber} ${context.attempt} -->`, '## KeyLint', '',
		`**Result:** ${exitCode === 0 ? 'passed' : 'failed'}`, '', '| Metric | Count |', '| --- | ---: |',
		`| Errors | ${counts.error} |`, `| Warnings | ${counts.warning} |`, '', `[Full report and artifacts](${context.reportUrl})`
	].join('\n');
}

/** Publish directly from scan data. --pr-comment authorizes only these CI API requests. */
export async function publishPrComment(counts: ISeverityCounts, exitCode: number, stderr: (text: string) => void, env: NodeJS.ProcessEnv = process.env): Promise<void> {
	const context: ICiCommentContext | undefined = await resolveContext(env);
	if (!context) {
		return;
	}
	if (!context.token) {
		stderr(AUTH_WARNING);
		return;
	}
	try {
		const authorId: number | undefined = context.provider === 'gitlab' ? (await request<{ id: number }>(context, '/user')).id : undefined;
		let existing: IComment | undefined;
		for (let page: number = 1; ; page += 1) {
			const ordering: string = context.provider === 'gitlab' ? '&sort=asc&order_by=created_at' : '';
			const comments: IComment[] = await request<IComment[]>(context, `${context.commentsPath}?per_page=100&page=${page}${ordering}`);
			existing = comments.find((comment: IComment): boolean => {
				const own: boolean = context.provider === 'github' ? comment.user?.login === 'github-actions[bot]' : comment.author?.id === authorId && !comment.system;
				return own && comment.body.startsWith(`${COMMENT_MARKER}\n`);
			});
			if (existing || comments.length < 100) {
				break;
			}
		}
		if (existing && isNewerComment(existing, context)) {
			return;
		}
		const current: IPullRequest = await request<IPullRequest>(context, context.parentPath);
		const open: boolean = current.state === (context.provider === 'github' ? 'open' : 'opened');
		const headSha: string | undefined = context.provider === 'github' ? current.head?.sha : current.sha;
		if (!open || headSha !== context.headSha) {
			return;
		}
		const updatePath: string = context.provider === 'github'
			? `${context.commentsPath.slice(0, context.commentsPath.lastIndexOf('/issues/'))}/issues/comments/${existing?.id}`
			: `${context.commentsPath}/${existing?.id}`;
		await request<unknown>(context, existing ? updatePath : context.commentsPath, existing ? context.provider === 'github' ? 'PATCH' : 'PUT' : 'POST',
			formatComment(counts, exitCode, context));
	} catch (error: unknown) {
		if (error instanceof CommentApiError && [401, 403].includes(error.status)) {
			stderr(AUTH_WARNING);
			return;
		}
		throw new Error('KeyLint: could not publish the pull request comment.', { cause: error });
	}
}
