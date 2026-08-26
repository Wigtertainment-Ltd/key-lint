import { describe, expect, it } from 'vitest';

import { IProjectScanResult } from '@key-lint/core';
import { REPORTERS } from './index.js';
import { redactReporterText } from './reporter.js';
import { IReporterContext } from './reporter.interfaces.js';

const secret = 'Bearer cross-reporter-secret';
const result = {
	projectRoot: '/project', adapterId: 'angular', startedAt: '', finishedAt: '', durationMs: 1,
	summary: {
		totalKeys: 1, used: 0, unused: 1, dynamicOrUncertain: 0, indirectUncertain: 0,
		missingInLanguage: 0, extraInLanguage: 0, placeholderMissing: 0,
		placeholderUncertain: 0, placeholderMismatch: 0, totalFindings: 1
	},
	findings: [{
		adapterId: 'angular',
		id: 'finding', key: 'SECRET', status: 'unused', severity: 'warning',
		message: `unsafe ${secret}`, evidence: [{ filePath: '/project/app.ts', snippet: secret }]
	}],
	errors: [], translationMatrix: { locales: [], rows: [], totalKeys: 0 }, metadata: { note: secret }
} satisfies IProjectScanResult;
const context: IReporterContext = {
	warnings: [`unsafe ${secret}`], color: false,
	thresholds: { maxErrors: 0, maxWarnings: -1 },
	counts: { error: 0, warning: 1, info: 0 }, sensitiveValues: [secret]
};

describe('reporter credential redaction', () => {
	for (const [name, reporter] of Object.entries(REPORTERS)) {
		it(`redacts configured credential values from ${name} output`, () => {
			const output = redactReporterText(reporter.format(result, context), context.sensitiveValues ?? []);
			expect(output).not.toContain(secret);
			expect(output).toContain('[redacted]');
		});
	}
});
