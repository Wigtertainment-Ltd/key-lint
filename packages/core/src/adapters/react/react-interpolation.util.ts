/** Reads default i18next interpolation syntax, including formatting and unescaped values. */
export function extractReactPlaceholders(value: string): string[] {
	const names: string[] = [...value.matchAll(/\{\{\s*-?\s*([^{}]+?)\s*\}\}/g)]
		.map((match: RegExpExecArray): string => match[1].split(',')[0].trim())
		.filter((name: string): boolean => name.length > 0 && !/\s/.test(name));
	return [...new Set(names)].sort((a: string, b: string): number => a.localeCompare(b));
}
