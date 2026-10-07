import { ITranslationResource } from '../models/translation-resource.model.js';

/**
 * Checks whether a value is a non-null object other than an array.
 * Does not inspect its prototype or require an object-literal origin.
 *
 * @param value - Value to classify for recursive translation merging.
 * @returns Whether the value is treated as an object with named entries.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Recursively copies arrays and enumerable string-keyed object entries.
 * Other values are returned unchanged; inputs are expected to be acyclic JSON values.
 *
 * @param value - Translation value to copy.
 * @returns A recursive copy of arrays and objects, or the original scalar value.
 */
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

/**
 * Recursively merges JSON translation objects without mutating either input.
 * Matching object entries are merged; later arrays and scalar values replace earlier ones.
 *
 * @param earlier - Lower-precedence translation object.
 * @param later - Higher-precedence translation object.
 * @returns A new translation object with recursively copied values.
 */
export function mergeTranslationObjects(earlier: Record<string, unknown>, later: Record<string, unknown>): Record<string, unknown> {
	const merged: Record<string, unknown> = cloneTranslationValue(earlier) as Record<string, unknown>;

	for (const [key, laterValue] of Object.entries(later)) {
		const earlierValue: unknown = merged[key];
		merged[key] = isPlainObject(earlierValue) && isPlainObject(laterValue)
			? mergeTranslationObjects(earlierValue, laterValue)
			: cloneTranslationValue(laterValue);
	}

	return merged;
}

/**
 * Groups resources by locale and merges them in ascending position order.
 * Higher-position resources override earlier entries; equal positions preserve input order.
 * Does not mutate resources or their translation content.
 *
 * @param resources - Translation resources carrying locale, position, and parsed content.
 * @returns Locale-to-content mappings with each locale's resources recursively merged.
 */
export function mergeTranslationResources(resources: ITranslationResource[]): Map<string, Record<string, unknown>> {
	const localeContent: Map<string, Record<string, unknown>> = new Map<string, Record<string, unknown>>();
	const ordered: ITranslationResource[] = [...resources].sort((left, right) => left.position - right.position);

	for (const resource of ordered) {
		localeContent.set(
			resource.locale,
			mergeTranslationObjects(localeContent.get(resource.locale) ?? {}, resource.content)
		);
	}

	return localeContent;
}
