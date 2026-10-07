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
	const names = new Set<string>();
	// Capture one non-empty, whitespace-free placeholder name between Mustache braces.
	// Examples: "{{name}}" and "{{ user.name }}"; names containing braces or whitespace are rejected.
	const regex = /\{\{\s*([^{}\s]+)\s*\}\}/g;
	let match: RegExpExecArray | null = regex.exec(value);

	while (match) {
		const name = match[1]?.trim();
		if (name) {
			names.add(name);
		}
		match = regex.exec(value);
	}

	return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * Splits source text outside quoted strings and nested parentheses, brackets, or braces.
 * Uses lightweight delimiter tracking rather than a full JavaScript parser.
 *
 * @param value - Expression text to split.
 * @param delimiter - Single-character separator; defaults to a comma.
 * @returns Trimmed segments, retaining empty segments and the final trailing segment.
 */
export function splitTopLevel(value: string, delimiter = ','): string[] {
	const parts: string[] = [];
	let start = 0;
	const stack: string[] = [];
	let stringDelimiter: string | null = null;

	for (let index = 0; index < value.length; index += 1) {
		const char = value[index];
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
	for (let index = 0; index < value.length; index += 1) {
		const char = value[index];
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
	const trimmed = value.trim();
	// Capture a property name wrapped in matching JavaScript single or double quotes.
	const quoted = /^(?:['"])([^'"]+)(?:['"])$/.exec(trimmed);
	if (quoted) {
		return quoted[1];
	}
	// Capture a statically known quoted computed property such as ["name"].
	const computedQuoted = /^\[\s*(?:['"])([^'"]+)(?:['"])\s*\]$/.exec(trimmed);
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
function parseObjectLiteral(value: string, prefix = ''): { names: string[]; dynamic: boolean; dynamicPrefixes: string[] } {
	const names = new Set<string>();
	const dynamicPrefixes = new Set<string>();
	let dynamic = false;
	const body = value.trim().slice(1, -1);

	for (const property of splitTopLevel(body)) {
		if (!property) {
			continue;
		}
		if (property.startsWith('...')) {
			dynamic = true;
			continue;
		}

		const colon = findTopLevelColon(property);
		const keySource = colon === -1 ? property : property.slice(0, colon);
		const key = staticPropertyName(keySource);
		if (!key) {
			dynamic = true;
			continue;
		}

		const path = prefix ? `${prefix}.${key}` : key;
		names.add(path);
		if (colon === -1) {
			continue;
		}

		const childSource = property.slice(colon + 1).trim();
		if (childSource.startsWith('{') && childSource.endsWith('}')) {
			const child = parseObjectLiteral(childSource, path);
			child.names.forEach((name) => names.add(name));
			child.dynamicPrefixes.forEach((name) => dynamicPrefixes.add(name));
			dynamic ||= child.dynamic;
		// Primitive literals cannot hide nested placeholder paths; other expressions may.
		} else if (!/^(?:null|undefined|true|false|-?\d+(?:\.\d+)?|['"`][\s\S]*['"`])$/.test(childSource)) {
			dynamicPrefixes.add(path);
		}
	}

	return {
		names: [...names].sort((a, b) => a.localeCompare(b)),
		dynamic,
		dynamicPrefixes: [...dynamicPrefixes].sort((a, b) => a.localeCompare(b))
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
	const trimmed = expression?.trim() ?? '';
	if (!trimmed) {
		return { kind: 'absent', names: [] };
	}
	if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
		return { kind: 'dynamic', names: [] };
	}

	const parsed = parseObjectLiteral(trimmed);
	return {
		kind: parsed.dynamic ? 'dynamic' : 'static',
		names: parsed.names,
		...(parsed.dynamicPrefixes.length ? { dynamicPrefixes: parsed.dynamicPrefixes } : {})
	};
}
