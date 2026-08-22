import { ITranslationResource } from '../models/translation-resource.model.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneTranslationValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) => cloneTranslationValue(entry));
	}
	if (isPlainObject(value)) {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [key, cloneTranslationValue(entry)])
		);
	}
	return value;
}

/** Recursively merges JSON translation objects without mutating either input. */
export function mergeTranslationObjects(
	earlier: Record<string, unknown>,
	later: Record<string, unknown>
): Record<string, unknown> {
	const merged = cloneTranslationValue(earlier) as Record<string, unknown>;

	for (const [key, laterValue] of Object.entries(later)) {
		const earlierValue = merged[key];
		merged[key] = isPlainObject(earlierValue) && isPlainObject(laterValue)
			? mergeTranslationObjects(earlierValue, laterValue)
			: cloneTranslationValue(laterValue);
	}

	return merged;
}

/** Groups resources by locale and merges them in their deterministic position order. */
export function mergeTranslationResources(
	resources: ITranslationResource[]
): Map<string, Record<string, unknown>> {
	const localeContent = new Map<string, Record<string, unknown>>();
	const ordered = [...resources].sort((left, right) => left.position - right.position);

	for (const resource of ordered) {
		localeContent.set(
			resource.locale,
			mergeTranslationObjects(localeContent.get(resource.locale) ?? {}, resource.content)
		);
	}

	return localeContent;
}
