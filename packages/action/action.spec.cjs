const { readFile } = require('node:fs/promises');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const actionPath = require.resolve('./action.yml');

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
