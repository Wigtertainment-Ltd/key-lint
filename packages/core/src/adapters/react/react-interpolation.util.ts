/** Reads default i18next interpolation syntax, including formatting and unescaped values. */
export function extractReactPlaceholders(value: string): string[] {
	const names = [...value.matchAll(/\{\{\s*-?\s*([^{}]+?)\s*\}\}/g)].map((match) => match[1].split(',')[0].trim()).filter((name) => name.length > 0 && !/\s/.test(name));
	return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}
