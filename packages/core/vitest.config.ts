import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/**/*.spec.ts'],
		setupFiles: ['./test/jasmine-matchers.ts'],
		environment: 'node'
	}
});
