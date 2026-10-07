/**
 * Trims a path, converts backslashes to forward slashes, and collapses repeated separators.
 * Removes a trailing slash except for Unix and drive roots; does not resolve dot segments or symlinks.
 *
 * @param value - Filesystem path or path-like pattern to normalize.
 * @returns The normalized path, preserving its letter case.
 */
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

/**
 * Creates a case-insensitive comparison key without accessing the filesystem.
 *
 * @param value - Path to normalize for duplicate detection.
 * @returns The normalized path converted to lowercase on every platform.
 */
export function pathDedupeKey(value: string): string {
	return normalizePath(value).toLowerCase();
}

/**
 * Infers a locale from the filename after removing its final extension.
 * Uses the last non-empty dotted segment, for example `messages.de.json` becomes `de`.
 * Does not validate the inferred locale or inspect parent directory names.
 *
 * @param filePath - Translation file path to inspect.
 * @returns The inferred locale, or the extensionless filename when no dotted suffix exists.
 */
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
