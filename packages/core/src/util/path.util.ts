export function normalizePath(value: string): string {
	const normalized = value
		.trim()
		// Convert every Windows path separator to the cross-platform forward-slash form.
		.replace(/\\/g, '/')
		// Collapse consecutive forward slashes into one separator.
		.replace(/\/+/g, '/');

	// Keep filesystem roots intact, but remove the trailing slash from every other path.
	return normalized === '/' || /^[A-Za-z]:\/$/.test(normalized)
		? normalized
		: normalized.replace(/\/$/, '');
}

export function pathDedupeKey(value: string): string {
	return normalizePath(value).toLowerCase();
}

export function inferLocaleFromTranslationFile(filePath: string): string {
	const normalized = normalizePath(filePath);
	const fileName = normalized.split('/').at(-1) ?? normalized;
	// Remove the final extension while preserving earlier dots used before a locale suffix.
	const withoutExtension = fileName.replace(/\.[^.]+$/, '');
	const dottedParts = withoutExtension.split('.').filter(Boolean);

	if (dottedParts.length > 1) {
		return dottedParts.at(-1) ?? withoutExtension;
	}

	return withoutExtension;
}
