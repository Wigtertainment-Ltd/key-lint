import { expect, MatcherResult } from 'vitest';

/**
 * The adapter specs were written against Jasmine before the engine moved into
 * this package. Vitest/Chai has no `toBeTrue`/`toBeFalse`, so they are
 * registered here instead of rewriting every assertion.
 */
expect.extend({
	toBeTrue(received: unknown): MatcherResult {
		return {
			pass: received === true,
			message: (): string => `expected ${String(received)} to be true`
		};
	},
	toBeFalse(received: unknown): MatcherResult {
		return {
			pass: received === false,
			message: (): string => `expected ${String(received)} to be false`
		};
	}
});

declare module 'vitest' {
	interface Matchers<R> {
		toBeTrue(): R;
		toBeFalse(): R;
	}
}
