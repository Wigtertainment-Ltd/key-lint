const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const MAX_SETTINGS_BYTES = 1024 * 1024;

function normalizeGuardrails(guardrails) {
	if (guardrails === undefined) return undefined;
	if (!guardrails || !Number.isSafeInteger(guardrails.maxFiles) || guardrails.maxFiles < 1 ||
		!Number.isSafeInteger(guardrails.maxFileSizeBytes) || guardrails.maxFileSizeBytes < 1) throw new TypeError('Invalid saved scan settings.');
	return { maxFiles: guardrails.maxFiles, maxFileSizeBytes: guardrails.maxFileSizeBytes };
}

function normalizeSources(sources) {
	if (!Array.isArray(sources) || sources.length > 100) throw new TypeError('Invalid saved translation sources.');
	const text = (value) => {
		if (typeof value !== 'string' || value.length > 65536) throw new TypeError('Invalid translation source field.');
		return value;
	};
	const strings = (value) => {
		if (!Array.isArray(value) || value.length > 1000) throw new TypeError('Invalid translation source list.');
		return value.map(text);
	};
	const normalized = sources.map((source) => {
		if (!source || !['filesystem', 'http', 'auto-http'].includes(source.type)) throw new TypeError('Invalid translation source type.');
		if (!Array.isArray(source.headers) || source.headers.length > 100) throw new TypeError('Invalid saved headers.');
		if (source.selectedCandidateIndex !== undefined && (!Number.isSafeInteger(source.selectedCandidateIndex) || source.selectedCandidateIndex < 0)) {
			throw new TypeError('Invalid loader candidate selection.');
		}
		return {
			type: source.type, id: text(source.id), includeGlobs: strings(source.includeGlobs), urlTemplate: text(source.urlTemplate),
			origin: text(source.origin), locales: strings(source.locales),
			headers: source.headers.map((header) => {
				if (!header || typeof header.configured !== 'boolean') throw new TypeError('Invalid saved header.');
				return { name: text(header.name), value: text(header.value), environmentName: text(header.environmentName), configured: header.configured };
			}),
			...(source.selectedCandidateIndex === undefined ? {} : { selectedCandidateIndex: source.selectedCandidateIndex })
		};
	});
	if (Buffer.byteLength(JSON.stringify(normalized)) > MAX_SETTINGS_BYTES) throw new RangeError('Saved translation sources exceed the size limit.');
	return normalized;
}

function createTranslationSourceStore({ app, fs, safeStorage, platform = process.platform }) {
	const pending = new Map();
	function location(projectRoot) {
		if (typeof projectRoot !== 'string' || !projectRoot.trim() || !path.isAbsolute(projectRoot)) throw new TypeError('Project path must be absolute.');
		let projectKey = path.normalize(projectRoot).replace(/[\\/]+$/, '');
		if (platform === 'win32') projectKey = projectKey.toLowerCase();
		const directory = path.join(app.getPath('userData'), 'translation-sources');
		const key = createHash('sha256').update(projectKey).digest('hex');
		return { directory, file: path.join(directory, `${key}.bin`), projectKey };
	}
	function requireEncryption() {
		if (!safeStorage?.isEncryptionAvailable() || (platform === 'linux' && ['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend()))) {
			throw new Error('Secure operating-system storage is unavailable. Translation sources cannot be saved or loaded.');
		}
	}
	function serialize(file, operation) {
		const result = (pending.get(file) ?? Promise.resolve()).then(operation);
		const settled = result.catch(() => {});
		pending.set(file, settled);
		void settled.then(() => { if (pending.get(file) === settled) pending.delete(file); });
		return result;
	}
	return {
		load(projectRoot) {
			const { file, projectKey } = location(projectRoot);
			return serialize(file, async () => {
				let encrypted;
				try {
					const stat = await fs.stat(file);
					if (stat.size > MAX_SETTINGS_BYTES + 65536) throw new Error('Saved translation sources exceed the size limit.');
					encrypted = await fs.readFile(file);
				} catch (error) {
					if (error.code === 'ENOENT') return undefined;
					throw new Error('Saved translation sources could not be read.');
				}
				requireEncryption();
				try {
					const data = JSON.parse(safeStorage.decryptString(encrypted));
					if (![1, 2].includes(data.version) || data.projectKey !== projectKey) throw new Error('Invalid saved data.');
					return { sources: normalizeSources(data.sources), guardrails: data.version === 2 ? normalizeGuardrails(data.guardrails) : undefined };
				} catch {
					throw new Error('Saved translation sources could not be decrypted or are invalid. Delete them and save the settings again.');
				}
			});
		},
		save(projectRoot, sources, guardrails) {
			const { directory, file, projectKey } = location(projectRoot);
			const normalized = normalizeSources(sources);
			const normalizedGuardrails = normalizeGuardrails(guardrails);
			return serialize(file, async () => {
				requireEncryption();
				const encrypted = safeStorage.encryptString(JSON.stringify({ version: 2, projectKey, sources: normalized, guardrails: normalizedGuardrails }));
				const temporary = `${file}.${randomUUID()}.tmp`;
				try {
					await fs.mkdir(directory, { recursive: true, mode: 0o700 });
					await fs.writeFile(temporary, encrypted, { flag: 'wx', mode: 0o600 });
					await fs.rename(temporary, file);
				} finally {
					await fs.unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
				}
			});
		},
		delete(projectRoot) {
			const { file } = location(projectRoot);
			return serialize(file, async () => {
				await fs.unlink(file).catch((error) => { if (error.code !== 'ENOENT') throw error; });
			});
		}
	};
}

module.exports = { createTranslationSourceStore, normalizeSources };
