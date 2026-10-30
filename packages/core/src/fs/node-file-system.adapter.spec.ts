import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { normalizePath } from '../util/path.util.js';
import { NodeFileSystemAdapter } from './node-file-system.adapter.js';
import { DEFAULT_SCANNER_CONFIG } from '../config/scanner-defaults.js';

const temporaryRoots: string[] = [];

afterEach(async (): Promise<void> => {
	await Promise.all(temporaryRoots.splice(0).map((root: string): Promise<void> => rm(root, { recursive: true, force: true })));
});

describe('NodeFileSystemAdapter', (): void => {
	it('prunes Angular build caches before considering generated JavaScript files', async (): Promise<void> => {
		const root: string = await mkdtemp(join(tmpdir(), 'keylint-cache-'));
		temporaryRoots.push(root);
		await mkdir(join(root, 'src'), { recursive: true });
		await mkdir(join(root, '.angular', 'cache'), { recursive: true });
		await writeFile(join(root, 'src', 'app.ts'), "translate.instant('title');", 'utf8');
		await writeFile(join(root, '.angular', 'cache', 'generated.js'), 'generated bundle', 'utf8');
		const fs: NodeFileSystemAdapter = new NodeFileSystemAdapter({ maxFiles: 1, maxFileSizeBytes: 1024 });
		expect(await fs.listFiles(root, DEFAULT_SCANNER_CONFIG.includeSourceGlobs, DEFAULT_SCANNER_CONFIG.excludeGlobs)).toEqual([normalizePath(join(root, 'src', 'app.ts'))]);
		expect(fs.warnings).toEqual([]);
	});

	it('applies relative exclude globs only within the selected project root', async (): Promise<void> => {
		const temporaryRoot: string = await mkdtemp(join(tmpdir(), 'keylint-fs-'));
		temporaryRoots.push(temporaryRoot);
		const projectRoot: string = join(temporaryRoot, 'tmp', 'project');
		const includedFile: string = join(projectRoot, 'src', 'app.ts');
		const excludedFile: string = join(projectRoot, 'tmp', 'generated.ts');
		await mkdir(join(projectRoot, 'src'), { recursive: true });
		await mkdir(join(projectRoot, 'tmp'), { recursive: true });
		await writeFile(includedFile, 'export const included = true;', 'utf8');
		await writeFile(excludedFile, 'export const excluded = true;', 'utf8');

		const files: string[] = await new NodeFileSystemAdapter().listFiles(
			projectRoot,
			['**/*.ts'],
			['**/tmp/**']
		);

		expect(files).toEqual([normalizePath(includedFile)]);
	});
});
