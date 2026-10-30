export interface IPlaceholderParameterUsage {
	kind: 'absent' | 'static' | 'dynamic';
	names: string[];
	dynamicPrefixes?: string[];
}

/**
 * Extracts Mustache placeholder names, including dotted property paths.
 * Allows surrounding whitespace inside braces but excludes names containing whitespace or braces.
 *
 * @param value - Translation string to inspect.
 * @returns Unique placeholder names sorted using `localeCompare`.
 */
export function extractMustachePlaceholders(value: string): string[] {
	const names: Set<string> = new Set<string>();
	// Capture one non-empty, whitespace-free placeholder name between Mustache braces.
	// Examples: "{{name}}" and "{{ user.name }}"; names containing braces or whitespace are rejected.
	const regex: RegExp = /\{\{\s*([^{}\s]+)\s*\}\}/g;
	let match: RegExpExecArray | null = regex.exec(value);

	while (match) {
		const name: string = match[1]?.trim();
		if (name) {
			names.add(name);
		}
		match = regex.exec(value);
	}

	return [...names].sort((a: string, b: string): number => a.localeCompare(b));
}

/**
 * Splits source text outside quoted strings and nested parentheses, brackets, or braces.
 * Uses lightweight delimiter tracking rather than a full JavaScript parser.
 *
 * @param value - Expression text to split.
 * @param delimiter - Single-character separator; defaults to a comma.
 * @returns Trimmed segments, retaining empty segments and the final trailing segment.
 */
export function splitTopLevel(value: string, delimiter: string = ','): string[] {
	const parts: string[] = [];
	let start: number = 0;
	const stack: string[] = [];
	let stringDelimiter: string | null = null;

	for (let index: number = 0; index < value.length; index += 1) {
		const char: string = value[index];
		if (stringDelimiter) {
			if (char === stringDelimiter && value[index - 1] !== '\\') {
				stringDelimiter = null;
			}
			continue;
		}

		if (char === "'" || char === '"' || char === '`') {
			stringDelimiter = char;
			continue;
		}

		if (char === '(' || char === '[' || char === '{') {
			stack.push(char);
			continue;
		}

		if (char === ')' || char === ']' || char === '}') {
			stack.pop();
			continue;
		}

		if (char === delimiter && stack.length === 0) {
			parts.push(value.slice(start, index).trim());
			start = index + 1;
		}
	}

	parts.push(value.slice(start).trim());
	return parts;
}

/**
 * Locates the first colon outside quoted strings and nested bracket groups.
 *
 * @param value - Object-property source text to inspect.
 * @returns The colon's zero-based character offset, or `-1` when none is found.
 */
function findTopLevelColon(value: string): number {
	let stringDelimiter: string | null = null;
	const stack: string[] = [];
	for (let index: number = 0; index < value.length; index += 1) {
		const char: string = value[index];
		if (stringDelimiter) {
			if (char === stringDelimiter && value[index - 1] !== '\\') {
				stringDelimiter = null;
			}
			continue;
		}
		if (char === "'" || char === '"' || char === '`') {
			stringDelimiter = char;
			continue;
		}
		if (char === '(' || char === '[' || char === '{') {
			stack.push(char);
			continue;
		}
		if (char === ')' || char === ']' || char === '}') {
			stack.pop();
			continue;
		}
		if (char === ':' && stack.length === 0) {
			return index;
		}
	}
	return -1;
}

/**
 * Recognizes identifier keys, quoted keys, and quoted computed keys from property text.
 * Captured quoted content is returned without decoding JavaScript escape sequences.
 *
 * @param value - Source text representing a property name.
 * @returns The recognized property name, or `null` for an unsupported or dynamic form.
 */
function staticPropertyName(value: string): string | null {
	const trimmed: string = value.trim();
	// Capture a property name wrapped in matching JavaScript single or double quotes.
	const quoted: RegExpExecArray | null = /^(?:['"])([^'"]+)(?:['"])$/.exec(trimmed);
	if (quoted) {
		return quoted[1];
	}
	// Capture a statically known quoted computed property such as ["name"].
	const computedQuoted: RegExpExecArray | null = /^\[\s*(?:['"])([^'"]+)(?:['"])\s*\]$/.exec(trimmed);
	if (computedQuoted) {
		return computedQuoted[1];
	}
	// Accept ordinary JavaScript identifier property names and reject dynamic expressions.
	return /^[A-Za-z_$][\w$]*$/.test(trimmed) ? trimmed : null;
}

/**
 * Collects known property paths from object-literal text without evaluating expressions.
 * Spreads and unknown keys mark the result dynamic; unresolved child expressions record path prefixes.
 * This lightweight analysis assumes the input is surrounded by object braces.
 *
 * @param value - Object-literal expression text, including its outer braces.
 * @param prefix - Optional parent path prepended to nested property names.
 * @returns Sorted unique paths, a dynamic-key flag, and prefixes whose nested paths remain unresolved.
 */
function parseObjectLiteral(value: string, prefix: string = ''): { names: string[]; dynamic: boolean; dynamicPrefixes: string[] } {
	const names: Set<string> = new Set<string>();
	const dynamicPrefixes: Set<string> = new Set<string>();
	let dynamic: boolean = false;
	const body: string = value.trim().slice(1, -1);

	for (const property of splitTopLevel(body)) {
		if (!property) {
			continue;
		}
		if (property.startsWith('...')) {
			dynamic = true;
			continue;
		}

		const colon: number = findTopLevelColon(property);
		const keySource: string = colon === -1 ? property : property.slice(0, colon);
		const key: string | null = staticPropertyName(keySource);
		if (!key) {
			dynamic = true;
			continue;
		}

		const path: string = prefix ? `${prefix}.${key}` : key;
		names.add(path);
		if (colon === -1) {
			continue;
		}

		const childSource: string = property.slice(colon + 1).trim();
		if (childSource.startsWith('{') && childSource.endsWith('}')) {
			const child: { names: string[]; dynamic: boolean; dynamicPrefixes: string[]; } = parseObjectLiteral(childSource, path);
			child.names.forEach((name: string): Set<string> => names.add(name));
			child.dynamicPrefixes.forEach((name: string): Set<string> => dynamicPrefixes.add(name));
			dynamic ||= child.dynamic;
		// Primitive literals cannot hide nested placeholder paths; other expressions may.
		} else if (!/^(?:null|undefined|true|false|-?\d+(?:\.\d+)?|['"`][\s\S]*['"`])$/.test(childSource)) {
			dynamicPrefixes.add(path);
		}
	}

	return {
		names: [...names].sort((a: string, b: string): number => a.localeCompare(b)),
		dynamic,
		dynamicPrefixes: [...dynamicPrefixes].sort((a: string, b: string): number => a.localeCompare(b))
	};
}

/**
 * Classifies translation parameter expressions and extracts statically recognizable property paths.
 * Blank input is absent; non-object expressions are dynamic. Object-like text is analyzed
 * heuristically without executing source code or performing full JavaScript syntax validation.
 *
 * @param expression - Optional source text of the translation call's parameter argument.
 * @returns Parameter classification, known paths, and any unresolved nested prefixes.
 */
export function parsePlaceholderParameters(expression?: string): IPlaceholderParameterUsage {
	const trimmed: string = expression?.trim() ?? '';
	if (!trimmed) {
		return { kind: 'absent', names: [] };
	}
	if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
		return { kind: 'dynamic', names: [] };
	}

	const parsed: { names: string[]; dynamic: boolean; dynamicPrefixes: string[]; } = parseObjectLiteral(trimmed);
	return {
		kind: parsed.dynamic ? 'dynamic' : 'static',
		names: parsed.names,
		...(parsed.dynamicPrefixes.length ? { dynamicPrefixes: parsed.dynamicPrefixes } : {})
	};
}
