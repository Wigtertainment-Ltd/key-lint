import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { normalizePath } from '../util/path.util.js';
import { NodeFileSystemAdapter } from './node-file-system.adapter.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('NodeFileSystemAdapter', () => {
	it('applies relative exclude globs only within the selected project root', async () => {
		const temporaryRoot = await mkdtemp(join(tmpdir(), 'keylint-fs-'));
		temporaryRoots.push(temporaryRoot);
		const projectRoot = join(temporaryRoot, 'tmp', 'project');
		const includedFile = join(projectRoot, 'src', 'app.ts');
		const excludedFile = join(projectRoot, 'tmp', 'generated.ts');
		await mkdir(join(projectRoot, 'src'), { recursive: true });
		await mkdir(join(projectRoot, 'tmp'), { recursive: true });
		await writeFile(includedFile, 'export const included = true;', 'utf8');
		await writeFile(excludedFile, 'export const excluded = true;', 'utf8');

		const files = await new NodeFileSystemAdapter().listFiles(
			projectRoot,
			['**/*.ts'],
			['**/tmp/**']
		);

		expect(files).toEqual([normalizePath(includedFile)]);
	});
});
