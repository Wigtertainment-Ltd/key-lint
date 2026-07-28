export function setNestedTranslationKey(target: Record<string, unknown>, key: string, value: string): void {
	const segments = key.split('.').map((segment) => segment.trim()).filter(Boolean);
	if (!segments.length) {
		return;
	}

	let cursor: Record<string, unknown> = target;
	for (let i = 0; i < segments.length - 1; i += 1) {
		const segment = segments[i];
		const current = cursor[segment];
		if (current === null || typeof current !== 'object' || Array.isArray(current)) {
			cursor[segment] = {};
		}

		cursor = cursor[segment] as Record<string, unknown>;
	}

	cursor[segments.at(-1) as string] = value;
}
