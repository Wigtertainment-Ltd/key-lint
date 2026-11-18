const { existsSync } = require('node:fs');
const { readFile, mkdtemp, rm } = require('node:fs/promises');
const { resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const actionPath = require.resolve('./action.yml');
const pagesWorkflowPath = resolve(__dirname, '../../docs/ci/github-actions.yml');
const ciDocsDirectory = resolve(__dirname, '../../docs/ci');

test('keeps the original Action interface backward compatible', async () => {
	const manifest = await readFile(actionPath, 'utf8');

	for (const input of ['path', 'config', 'version', 'max-errors', 'max-warnings', 'ignore', 'report-directory', 'job-summary', 'allow-network']) {
		assert.match(manifest, new RegExp(`^  ${input}:`, 'm'));
	}
	for (const output of ['exit-code', 'total-findings', 'error-count', 'warning-count', 'json-report', 'markdown-report']) {
		assert.match(manifest, new RegExp(`^  ${output}:`, 'm'));
	}
	assert.match(manifest, /--output "json=\$\{json_report\}"/);
	assert.match(manifest, /--output "markdown=\$\{markdown_report\}"/);
});

test('lists all reporters consistently in public documentation', async () => {
	const documentationPaths = [
		resolve(__dirname, '../../README.md'),
		resolve(__dirname, '../cli/README.md'),
		resolve(__dirname, 'README.md'),
		resolve(ciDocsDirectory, 'README.md')
	];

	for (const documentationPath of documentationPaths) {
		const documentation = await readFile(documentationPath, 'utf8');
		assert.match(documentation, /`text`, `json`, `markdown` (?:or|and) `html`/);
	}
});

test('network access is disabled by default and forwarded only after explicit opt-in', async () => {
	const manifest = await readFile(actionPath, 'utf8');

	assert.match(manifest, /allow-network:\s*\r?\n(?:.*\r?\n)*?\s+default: 'false'/);
	assert.match(manifest, /INPUT_ALLOW_NETWORK: \$\{\{ inputs\.allow-network \}\}/);
	assert.match(manifest, /true\) args\+=\(--allow-network\)/);
	assert.match(manifest, /false\) ;;/);
	assert.doesNotMatch(manifest, /INPUT_CONFIG[^\n]*allow-network/);
});

test('invalid allow-network values fail before the CLI is invoked', async () => {
	const manifest = await readFile(actionPath, 'utf8');

	const validationOffset = manifest.indexOf("allow-network must be 'true' or 'false'.");
	const invocationOffset = manifest.indexOf('npx --yes');
	assert.ok(validationOffset >= 0);
	assert.ok(invocationOffset > validationOffset);
});

test('generates a directly publishable HTML site alongside private reports', async () => {
	const manifest = await readFile(actionPath, 'utf8');

	assert.match(manifest, /site_dir="\$\{report_dir\}\/site"/);
	assert.match(manifest, /mkdir -p "\$\{site_dir\}"/);
	assert.match(manifest, /json_report="\$\{report_dir\}\/keylint\.json"/);
	assert.match(manifest, /markdown_report="\$\{report_dir\}\/keylint\.md"/);
	assert.match(manifest, /html_report="\$\{site_dir\}\/index\.html"/);
	assert.match(manifest, /args\+=\(--output "html=\$\{html_report\}"\)/);
	assert.doesNotMatch(manifest, /json_report="\$\{site_dir\}/);
	assert.doesNotMatch(manifest, /markdown_report="\$\{site_dir\}/);
});

test('exposes the HTML report and site directory after the CLI finishes', async () => {
	const manifest = await readFile(actionPath, 'utf8');

	assert.match(manifest, /value: \$\{\{ steps\.scan\.outputs\.json-report \}\}/);
	assert.match(manifest, /value: \$\{\{ steps\.scan\.outputs\.markdown-report \}\}/);
	assert.match(manifest, /html-report:\s*\r?\n\s+description:.*\r?\n\s+value: \$\{\{ steps\.scan\.outputs\.html-report \}\}/);
	assert.match(manifest, /site-directory:\s*\r?\n\s+description:.*\r?\n\s+value: \$\{\{ steps\.scan\.outputs\.site-directory \}\}/);
	assert.match(manifest, /echo "html-report=\$\{html_report\}" >> "\$GITHUB_OUTPUT"/);
	assert.match(manifest, /echo "site-directory=\$\{site_dir\}" >> "\$GITHUB_OUTPUT"/);

	const invocationOffset = manifest.indexOf('npx --yes');
	const htmlOutputOffset = manifest.indexOf('echo "html-report=${html_report}"');
	const finalExitOffset = manifest.lastIndexOf('exit "${exit_code}"');
	assert.ok(invocationOffset >= 0);
	assert.ok(htmlOutputOffset > invocationOffset);
	assert.ok(finalExitOffset > htmlOutputOffset);
});

test('documents a syntax-valid and default-branch-only GitHub Pages deployment', async () => {
	const workflow = await readFile(pagesWorkflowPath, 'utf8');
	const prettier = await import('prettier');

	await assert.doesNotReject(() => prettier.format(workflow, { filepath: pagesWorkflowPath }));
	assert.match(workflow, /uses: actions\/configure-pages@v5/);
	assert.match(workflow, /uses: actions\/upload-pages-artifact@v4/);
	assert.match(workflow, /uses: actions\/deploy-pages@v4/);
	assert.match(workflow, /pages: write/);
	assert.match(workflow, /id-token: write/);
	assert.match(workflow, /name: github-pages/);
	assert.match(workflow, /url: \$\{\{ steps\.deployment\.outputs\.page_url \}\}/);
	assert.match(workflow, /steps\.i18n\.outputs\.site-directory/);
	assert.match(workflow, /\[ -f "\$\{HTML_REPORT\}" \]/);
	assert.match(workflow, /if: always\(\)/);
	assert.match(workflow, /pull_request:/);
	assert.match(workflow, /github\.event_name == 'push'/);
	assert.match(workflow, /github\.event\.repository\.default_branch/g);
	assert.match(workflow, /uses: actions\/upload-artifact@v4/);
	assert.match(workflow, /uses: actions\/download-artifact@v4/);
});

test('keeps cross-platform YAML examples valid and retains the public HTML site', async () => {
	const prettier = await import('prettier');
	const yamlPaths = [
		resolve(ciDocsDirectory, 'gitlab-ci.yml'),
		resolve(ciDocsDirectory, 'azure-pipelines.yml')
	];

	for (const yamlPath of yamlPaths) {
		const example = await readFile(yamlPath, 'utf8');
		await assert.doesNotReject(() => prettier.format(example, { filepath: yamlPath }));
		assert.match(example, /html=.*site\/index\.html/);
	}
	for (const workflowName of ['github-actions-s3.yml', 'github-actions-netlify.yml']) {
		const workflowPath = resolve(ciDocsDirectory, workflowName);
		const workflow = await readFile(workflowPath, 'utf8');
		await assert.doesNotReject(() => prettier.format(workflow, { filepath: workflowPath }));
	}

	const jenkins = await readFile(resolve(ciDocsDirectory, 'Jenkinsfile'), 'utf8');
	assert.match(jenkins, /--output html=keylint-report\/site\/index\.html/);
	assert.match(jenkins, /post\s*\{\s*always\s*\{/);
});

test('syntax-checks provider scripts and prevents accidental private report publication', async () => {
	const s3Path = resolve(ciDocsDirectory, 'publish-s3.sh');
	const netlifyPath = resolve(ciDocsDirectory, 'publish-netlify.sh');
	const windowsGitBash = resolve(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe');
	const shell = process.platform === 'win32' && existsSync(windowsGitBash) ? windowsGitBash : 'sh';

	for (const scriptPath of [s3Path, netlifyPath]) {
		const check = spawnSync(shell, ['-n', scriptPath], { encoding: 'utf8' });
		assert.equal(check.status, 0, check.stderr);
	}

	const s3 = await readFile(s3Path, 'utf8');
	assert.match(s3, /\[ ! -f "\$\{site_dir\}\/index\.html" \]/);
	assert.match(s3, /aws s3 cp "\$\{site_dir\}\/index\.html"/);
	assert.match(s3, /--content-type "text\/html; charset=utf-8"/);
	assert.match(s3, /--cache-control "no-cache, max-age=0, must-revalidate"/);
	assert.doesNotMatch(s3, /--acl|keylint\.json|keylint\.md/);
	const s3Workflow = await readFile(resolve(ciDocsDirectory, 'github-actions-s3.yml'), 'utf8');
	assert.match(s3Workflow, /uses: aws-actions\/configure-aws-credentials@v6/);
	assert.match(s3Workflow, /id-token: write/);
	assert.match(s3Workflow, /hashFiles\('keylint-report\/site\/index\.html'\) != ''/);
	assert.match(s3Workflow, /if: always\(\)/);
	assert.doesNotMatch(s3Workflow, /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/);

	const netlify = await readFile(netlifyPath, 'utf8');
	assert.match(netlify, /NETLIFY_AUTH_TOKEN/);
	assert.match(netlify, /NETLIFY_SITE_ID/);
	assert.match(netlify, /preview\)/);
	assert.match(netlify, /production\)/);
	assert.match(netlify, /--prod/);
	assert.doesNotMatch(netlify, /keylint\.json|keylint\.md/);
	const netlifyWorkflow = await readFile(resolve(ciDocsDirectory, 'github-actions-netlify.yml'), 'utf8');
	assert.match(netlifyWorkflow, /NETLIFY_AUTH_TOKEN: \$\{\{ secrets\.NETLIFY_AUTH_TOKEN \}\}/);
	assert.match(netlifyWorkflow, /NETLIFY_SITE_ID: \$\{\{ secrets\.NETLIFY_SITE_ID \}\}/);
	assert.match(netlifyWorkflow, /KEYLINT_NETLIFY_DEPLOY_MODE: preview/);
	assert.match(netlifyWorkflow, /KEYLINT_NETLIFY_DEPLOY_MODE: production/);
	assert.match(netlifyWorkflow, /hashFiles\('keylint-report\/site\/index\.html'\) != ''/);
});

test('uses the native CLI comment option for both CI providers without helper scripts', async () => {
	const action = await readFile(actionPath, 'utf8');
	const gitlab = await readFile(resolve(ciDocsDirectory, 'gitlab-ci.yml'), 'utf8');
	const prettier = await import('prettier');
	await assert.doesNotReject(() => prettier.format(action, { parser: 'yaml' }));
	// Match the input declaration through its opt-in default.
	assert.match(action, /pr-comment:\s*\r?\n\s+description:.*\r?\n\s+required: false\r?\n\s+default: 'false'/);
	assert.ok(action.includes('args+=(--pr-comment)'));
	assert.ok(action.includes("GITHUB_TOKEN: ${{ inputs.pr-comment == 'true' && github.token || '' }}"));
	assert.ok(gitlab.includes('--pr-comment'));
	assert.ok(!action.includes('pr-comment.cjs'));
	assert.ok(!action.includes('KEYLINT_ACTION_PATH'));
	assert.ok(!gitlab.includes('comment-gitlab.cjs'));
	assert.ok(!gitlab.includes('KEYLINT_EXIT_CODE'));
	assert.equal(existsSync(resolve(__dirname, 'pr-comment.cjs')), false);
	assert.equal(existsSync(resolve(ciDocsDirectory, 'comment-gitlab.cjs')), false);
});

test('forwards comment opt-in and token to the CLI while preserving exit codes, outputs and summary', async (context) => {
	const directory = await mkdtemp(resolve(tmpdir(), 'keylint-action-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const action = (await readFile(actionPath, 'utf8')).replaceAll('\r\n', '\n');
	const scanScript = action.split('      run: |\n')[1].split('\n').map((line) => line.slice(8)).join('\n');
	const windowsGitBash = resolve(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe');
	const shell = process.platform === 'win32' && existsSync(windowsGitBash) ? windowsGitBash : 'bash';
	const mockNpx = `npx() {
  printf '%s\n' "$@" > invocation
  printf '%s' "$GITHUB_TOKEN" > token
  printf '%s' '{"findings":[],"severityCounts":{"error":2,"warning":3}}' > "$INPUT_REPORT_DIRECTORY/keylint.json"
  printf '%s' '# KeyLint test report' > "$INPUT_REPORT_DIRECTORY/keylint.md"
  return "$MOCK_EXIT_CODE"
}
`;
	for (const enabled of ['true', 'false']) {
		for (const exitCode of [0, 1, 2]) {
			const suffix = `${enabled}-${exitCode}`;
			const result = spawnSync(shell, ['-c', mockNpx + scanScript], {
				cwd: directory,
				encoding: 'utf8',
				env: {
					...process.env,
					INPUT_PR_COMMENT: enabled,
					INPUT_ALLOW_NETWORK: 'false',
					INPUT_PATH: '.',
					INPUT_CONFIG: '',
					INPUT_VERSION: 'latest',
					INPUT_MAX_ERRORS: '0',
					INPUT_MAX_WARNINGS: '',
					INPUT_IGNORE: '',
					INPUT_REPORT_DIRECTORY: `report-${suffix}`,
					INPUT_JOB_SUMMARY: 'true',
					GITHUB_TOKEN: enabled === 'true' ? 'workflow-token' : '',
					GITHUB_OUTPUT: `output-${suffix}`,
					GITHUB_STEP_SUMMARY: `summary-${suffix}`,
					MOCK_EXIT_CODE: String(exitCode)
				}
			});
			assert.equal(result.status, exitCode, result.stderr);
			const invocation = (await readFile(resolve(directory, 'invocation'), 'utf8')).trimEnd().split('\n');
			assert.equal(invocation.filter((argument) => argument === '--pr-comment').length, enabled === 'true' ? 1 : 0);
			assert.equal(await readFile(resolve(directory, 'token'), 'utf8'), enabled === 'true' ? 'workflow-token' : '');
			const output = await readFile(resolve(directory, `output-${suffix}`), 'utf8');
			assert.ok(output.includes(`exit-code=${exitCode}`));
			assert.ok(output.includes(`json-report=report-${suffix}/keylint.json`));
			assert.ok(output.includes('error-count=2'));
			assert.ok(output.includes('warning-count=3'));
			assert.equal(await readFile(resolve(directory, `summary-${suffix}`), 'utf8'), '# KeyLint test report');
		}
	}

	const invalidInput = spawnSync(shell, ['-c', 'npx() { printf invoked > invalid-invocation; exit 99; }\n' + scanScript], {
		cwd: directory,
		encoding: 'utf8',
		env: { ...process.env, INPUT_PR_COMMENT: 'yes' }
	});
	assert.equal(invalidInput.status, 2, invalidInput.stderr);
	assert.ok(invalidInput.stderr.includes("pr-comment must be 'true' or 'false'."));
	assert.equal(existsSync(resolve(directory, 'invalid-invocation')), false);
});
