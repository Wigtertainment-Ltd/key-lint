export function normalizePath(value: string): string {
	return value
		// Convert every Windows path separator to the cross-platform forward-slash form.
		.replace(/\\/g, '/')
		// Collapse consecutive forward slashes into one separator.
		.replace(/\/+/g, '/');
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
