const { existsSync } = require('node:fs');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const actionPath = require.resolve('./action.yml');
const pagesWorkflowPath = resolve(__dirname, '../../docs/ci/github-actions.yml');
const ciDocsDirectory = resolve(__dirname, '../../docs/ci');

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
