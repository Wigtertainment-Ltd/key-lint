const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const actionPath = require.resolve('./action.yml');
const pagesWorkflowPath = resolve(__dirname, '../../docs/ci/github-actions.yml');

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
