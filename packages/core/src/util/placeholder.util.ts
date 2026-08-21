export interface IPlaceholderParameterUsage {
	kind: 'absent' | 'static' | 'dynamic';
	names: string[];
	dynamicPrefixes?: string[];
}

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
