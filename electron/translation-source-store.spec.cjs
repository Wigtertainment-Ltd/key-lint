const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const test = require('node:test');
const { createTranslationSourceStore } = require('./translation-source-store');
const { registerIpcHandlers } = require('./ipc-handlers');
const { IPC_CHANNELS } = require('./ipc-channels');

const sources = [{
	type: 'http', id: 'remote', includeGlobs: [], urlTemplate: 'https://example.com/{locale}.json', origin: '', locales: ['de', 'en'],
	headers: [{ name: 'Authorization', value: 'Bearer test-secret', environmentName: 'KEYLINT_AUTH', configured: false }]
}];

async function harness(t) {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'keylint-source-store-'));
	t.after(() => fs.rm(directory, { recursive: true, force: true }));
	const key = randomBytes(32);
	const safeStorage = {
		isEncryptionAvailable: () => true,
		getSelectedStorageBackend: () => 'gnome_libsecret',
		encryptString: (text) => {
			const iv = randomBytes(12);
			const cipher = createCipheriv('aes-256-gcm', key, iv);
			const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
			return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
		},
		decryptString: (buffer) => {
			const decipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12));
			decipher.setAuthTag(buffer.subarray(12, 28));
			return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8');
		}
	};
	const options = { app: { getPath: () => directory }, fs, safeStorage };
	const project = path.join(directory, 'project');
	return { directory, project, options, store: createTranslationSourceStore(options) };
}

test('saves encrypted sources, restores after store recreation, isolates projects and deletes idempotently', async (t) => {
	const { directory, project, options, store } = await harness(t);
	assert.equal(await store.load(project), undefined);
	await store.save(project, sources);
	const filenames = await fs.readdir(path.join(directory, 'translation-sources'));
	assert.equal(filenames.length, 1);
	const bytes = await fs.readFile(path.join(directory, 'translation-sources', filenames[0]));
	assert.equal(bytes.includes(Buffer.from('test-secret')), false);
	assert.equal(bytes.includes(Buffer.from('example.com')), false);
	assert.deepEqual((await createTranslationSourceStore(options).load(project)).sources, sources);
	assert.equal(await store.load(path.join(directory, 'other-project')), undefined);
	await store.delete(project);
	await store.delete(project);
	assert.equal(await store.load(project), undefined);
});

test('normalizes Windows project identity, preserves source order and omits transient analysis', async (t) => {
	const { project, options } = await harness(t);
	const store = createTranslationSourceStore({ ...options, platform: 'win32' });
	const saved = [sources[0], { ...sources[0], type: 'filesystem', id: 'local', headers: [] }, {
		...sources[0], type: 'auto-http', selectedCandidateIndex: 2, draftId: 'transient', autoCandidates: [{ data: 'stale' }]
	}];
	await store.save(project, saved);
	const loaded = (await store.load(project.toUpperCase() + path.sep)).sources;
	assert.deepEqual(loaded.map((source) => source.type), ['http', 'filesystem', 'auto-http']);
	assert.equal(loaded[2].selectedCandidateIndex, 2);
	assert.equal(loaded[2].draftId, undefined);
	assert.equal(loaded[2].autoCandidates, undefined);
});

test('refuses unavailable encryption and insecure Linux fallback without writing files', async (t) => {
	const { directory, project, options } = await harness(t);
	for (const safeStorage of [
		{ ...options.safeStorage, isEncryptionAvailable: () => false },
		{ ...options.safeStorage, getSelectedStorageBackend: () => 'basic_text' }
	]) {
		const store = createTranslationSourceStore({ ...options, safeStorage, platform: 'linux' });
		await assert.rejects(store.save(project, sources), /Secure operating-system storage is unavailable/);
	}
	assert.deepEqual(await fs.readdir(directory), []);
});

test('rejects malformed inputs and relative project paths', async (t) => {
	const { project, store } = await harness(t);
	assert.throws(() => store.save('../project', sources), /absolute/);
	for (const invalid of [null, [{}], [{ ...sources[0], headers: [{ value: 'secret' }] }], [{ ...sources[0], selectedCandidateIndex: -1 }]]) {
		assert.throws(() => store.save(project, invalid), /Invalid/);
	}
	assert.throws(() => store.save(project, Array(101).fill(sources[0])), /Invalid/);
	assert.throws(() => store.save(project, Array(30).fill({ ...sources[0], origin: 'x'.repeat(65536) })), /size limit/);
});

test('failed replacement retains the previous settings and cleans temporary files', async (t) => {
	const { directory, project, options, store } = await harness(t);
	await store.save(project, sources);
	const broken = createTranslationSourceStore({ ...options, fs: { ...fs, rename: async () => { throw new Error('write failed'); } } });
	await assert.rejects(broken.save(project, [{ ...sources[0], id: 'changed' }]), /write failed/);
	assert.deepEqual((await store.load(project)).sources, sources);
	assert.equal((await fs.readdir(path.join(directory, 'translation-sources'))).length, 1);
});

test('corrupt saved data yields a generic error and can still be deleted without encryption', async (t) => {
	const { directory, project, options, store } = await harness(t);
	await store.save(project, sources);
	const [filename] = await fs.readdir(path.join(directory, 'translation-sources'));
	await fs.writeFile(path.join(directory, 'translation-sources', filename), 'corrupt');
	await assert.rejects(store.load(project), /could not be decrypted or are invalid/);
	const unavailable = createTranslationSourceStore({ ...options, safeStorage: undefined });
	await unavailable.delete(project);
	assert.equal(await unavailable.load(project), undefined);
});

test('serializes overlapping saves and deletion so deleted settings cannot reappear', async (t) => {
	const { project, store } = await harness(t);
	await Promise.all([store.save(project, sources), store.save(project, [{ ...sources[0], id: 'latest' }])]);
	assert.equal((await store.load(project)).sources[0].id, 'latest');
	await Promise.all([store.save(project, sources), store.delete(project)]);
	assert.equal(await store.load(project), undefined);
});

test('IPC handlers expose project-scoped save, load and delete', async (t) => {
	const { project, options } = await harness(t);
	const handlers = new Map();
	registerIpcHandlers({ ...options, ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, dialog: {} });
	await handlers.get(IPC_CHANNELS.saveProjectSettings)(null, project, sources);
	assert.deepEqual((await handlers.get(IPC_CHANNELS.loadProjectSettings)(null, project)).sources, sources);
	await handlers.get(IPC_CHANNELS.deleteProjectSettings)(null, project);
	assert.equal(await handlers.get(IPC_CHANNELS.loadProjectSettings)(null, project), undefined);
});

test('persists scan guardrails together with sources and rejects invalid limits', async (t) => {
	const { project, options, store } = await harness(t);
	const guardrails = { maxFiles: 250, maxFileSizeBytes: 2097152 };
	await store.save(project, sources, guardrails);
	assert.deepEqual(await createTranslationSourceStore(options).load(project), { sources, guardrails });
	for (const invalid of [{ maxFiles: 0, maxFileSizeBytes: 10 }, { maxFiles: 10, maxFileSizeBytes: -1 }, { maxFiles: 1.5, maxFileSizeBytes: 10 }]) {
		assert.throws(() => store.save(project, sources, invalid), /Invalid saved scan settings/);
	}
});

test('loads the previous source-only file format without requiring scan settings', async (t) => {
	const { directory, project, options, store } = await harness(t);
	await store.save(project, sources);
	const [filename] = await fs.readdir(path.join(directory, 'translation-sources'));
	const file = path.join(directory, 'translation-sources', filename);
	const data = JSON.parse(options.safeStorage.decryptString(await fs.readFile(file)));
	data.version = 1;
	delete data.guardrails;
	await fs.writeFile(file, options.safeStorage.encryptString(JSON.stringify(data)));
	assert.deepEqual(await store.load(project), { sources, guardrails: undefined });
});
