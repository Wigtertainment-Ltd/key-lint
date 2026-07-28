import { expect } from 'vitest';

/**
 * The adapter specs were written against Jasmine before the engine moved into
 * this package. Vitest/Chai has no `toBeTrue`/`toBeFalse`, so they are
 * registered here instead of rewriting every assertion.
 */
expect.extend({
	toBeTrue(received: unknown) {
		return {
			pass: received === true,
			message: () => `expected ${String(received)} to be true`
		};
	},
	toBeFalse(received: unknown) {
		return {
			pass: received === false,
			message: () => `expected ${String(received)} to be false`
		};
	}
});

interface JasmineStyleMatchers<R = unknown> {
	toBeTrue(): R;
	toBeFalse(): R;
}

declare module 'vitest' {
	interface Assertion<T = any> extends JasmineStyleMatchers<T> { }
	interface AsymmetricMatchersContaining extends JasmineStyleMatchers { }
}
