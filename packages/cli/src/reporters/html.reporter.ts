import { basename, isAbsolute, relative, resolve } from 'node:path';

import { IFinding, IProjectScanResult, normalizePath } from '@key-lint/core';
import { redactReporterText, severityRank } from './reporter.js';
import type { IReporter, IReporterContext } from './reporter.interfaces.js';

function redact(value: unknown, context: IReporterContext): string {
	return redactReporterText(String(value ?? ''), context.sensitiveValues ?? []);
}

function escapeHtml(value: unknown, context: IReporterContext): string {
	return redact(value, context)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function projectName(projectRoot: string): string {
	return basename(resolve(projectRoot)) || 'project';
}

function isOutsideProject(relativePath: string): boolean {
	return relativePath === '..' || relativePath.startsWith('../') || isAbsolute(relativePath);
}

function displayPath(projectRoot: string, filePath: string): string {
	const resolvedRoot = resolve(projectRoot);
	const resolvedFile = isAbsolute(filePath) ? resolve(filePath) : resolve(resolvedRoot, filePath);
	const projectRelative = normalizePath(relative(resolvedRoot, resolvedFile));

	if (!projectRelative) {
		return '.';
	}

	if (isOutsideProject(projectRelative)) {
		return `external/${basename(resolvedFile)}`;
	}

	return projectRelative;
}

function stripProjectRoot(value: string, projectRoot: string): string {
	const candidates = [...new Set([
		projectRoot,
		resolve(projectRoot),
		normalizePath(projectRoot),
		normalizePath(resolve(projectRoot))
	])]
		.filter(Boolean)
		.sort((left, right) => right.length - left.length);

	return candidates.reduce((text, candidate) => {
		let sanitized = text;
		let offset = sanitized.toLowerCase().indexOf(candidate.toLowerCase());
		while (offset >= 0) {
			sanitized = `${sanitized.slice(0, offset)}.${sanitized.slice(offset + candidate.length)}`;
			offset = sanitized.toLowerCase().indexOf(candidate.toLowerCase(), offset + 1);
		}
		return sanitized;
	}, value);
}

function locationOf(finding: IFinding, projectRoot: string): string {
	const evidence = finding.evidence[0];
	if (!evidence) {
		return '-';
	}

	const path = displayPath(projectRoot, evidence.filePath);
	if (evidence.line === undefined) {
		return path;
	}

	return evidence.column === undefined
		? `${path}:${evidence.line}`
		: `${path}:${evidence.line}:${evidence.column}`;
}

function thresholdStatus(context: IReporterContext): 'passed' | 'failed' {
	const warningsExceeded = context.thresholds.maxWarnings >= 0
		&& context.counts.warning > context.thresholds.maxWarnings;
	return context.counts.error > context.thresholds.maxErrors || warningsExceeded ? 'failed' : 'passed';
}

function metricRow(label: string, value: number, context: IReporterContext): string {
	return `<tr><th scope="row">${escapeHtml(label, context)}</th><td>${escapeHtml(value, context)}</td></tr>`;
}

function findingRow(finding: IFinding, result: IProjectScanResult, context: IReporterContext): string {
	return [
		`<tr class="finding finding--${escapeHtml(finding.severity, context)}">`,
		`<td><span class="badge badge--${escapeHtml(finding.severity, context)}">${escapeHtml(finding.severity, context)}</span></td>`,
		`<td>${escapeHtml(finding.status, context)}</td>`,
		`<td><code>${escapeHtml(finding.key, context)}</code></td>`,
		`<td>${escapeHtml(finding.language ?? '-', context)}</td>`,
		`<td>${escapeHtml(stripProjectRoot(finding.message, result.projectRoot), context)}</td>`,
		`<td><code>${escapeHtml(locationOf(finding, result.projectRoot), context)}</code></td>`,
		'</tr>'
	].join('');
}

export const htmlReporter: IReporter = {
	name: 'html',
	format(result: IProjectScanResult, context: IReporterContext): string {
		const status = thresholdStatus(context);
		const baseLocale = result.metadata?.['baseLocale'];
		const findings = [...result.findings].sort((left, right) =>
			severityRank(left.severity) - severityRank(right.severity)
			|| left.key.localeCompare(right.key)
			|| left.id.localeCompare(right.id)
		);
		const findingRows = findings.length > 0
			? findings.map((finding) => findingRow(finding, result, context)).join('\n')
			: '<tr><td colspan="6" class="empty">No findings.</td></tr>';
		const warningItems = context.warnings
			.map((warning) => `<li>${escapeHtml(stripProjectRoot(warning, result.projectRoot), context)}</li>`)
			.join('\n');
		const configPath = context.configFilePath
			? displayPath(result.projectRoot, context.configFilePath)
			: undefined;
		const maxWarnings = context.thresholds.maxWarnings < 0
			? 'unlimited'
			: String(context.thresholds.maxWarnings);

		return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
	<title>KeyLint report - ${escapeHtml(projectName(result.projectRoot), context)}</title>
	<style>
		:root { color-scheme: light dark; --bg: #f5f7fb; --surface: #fff; --text: #182230; --muted: #667085; --border: #d0d5dd; --pass: #067647; --pass-bg: #ecfdf3; --fail: #b42318; --fail-bg: #fef3f2; --warning: #b54708; --warning-bg: #fffaeb; --info: #175cd3; --info-bg: #eff8ff; }
		* { box-sizing: border-box; }
		body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
		main { width: min(1200px, calc(100% - 32px)); margin: 32px auto; }
		h1, h2 { line-height: 1.2; }
		h1 { margin: 0; font-size: clamp(1.75rem, 4vw, 2.5rem); }
		h2 { margin: 0 0 16px; font-size: 1.25rem; }
		code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
		.report-header, section { margin-bottom: 24px; padding: 24px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); box-shadow: 0 1px 3px rgb(16 24 40 / 8%); }
		.report-header { border-left: 8px solid var(--${status === 'passed' ? 'pass' : 'fail'}); }
		.eyebrow { margin: 0 0 8px; color: var(--muted); font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
		.status { display: inline-block; margin-top: 16px; padding: 5px 10px; border-radius: 999px; color: var(--${status === 'passed' ? 'pass' : 'fail'}); background: var(--${status === 'passed' ? 'pass' : 'fail'}-bg); font-weight: 800; text-transform: uppercase; }
		.metadata { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px 24px; margin: 20px 0 0; }
		.metadata div { min-width: 0; }
		dt { color: var(--muted); font-size: .82rem; font-weight: 700; text-transform: uppercase; }
		dd { margin: 2px 0 0; overflow-wrap: anywhere; }
		.table-wrap { overflow-x: auto; }
		table { width: 100%; border-collapse: collapse; }
		th, td { padding: 11px 12px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
		th { font-size: .82rem; letter-spacing: .03em; text-transform: uppercase; }
		tbody tr:last-child th, tbody tr:last-child td { border-bottom: 0; }
		.metrics td { text-align: right; font-variant-numeric: tabular-nums; }
		.findings-table { min-width: 1100px; table-layout: fixed; }
		.findings-table .col-severity { width: 95px; }
		.findings-table .col-status { width: 140px; }
		.findings-table .col-key { width: 220px; }
		.findings-table .col-locale { width: 70px; }
		.findings-table .col-message { width: 355px; }
		.findings-table .col-location { width: 220px; }
		.findings-table code { overflow-wrap: break-word; word-break: normal; }
		.badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: .78rem; font-weight: 800; text-transform: uppercase; }
		.badge--error { color: var(--fail); background: var(--fail-bg); }
		.badge--warning { color: var(--warning); background: var(--warning-bg); }
		.badge--info { color: var(--info); background: var(--info-bg); }
		.empty { color: var(--muted); text-align: center; }
		ul { margin: 0; padding-left: 22px; }
		@media (prefers-color-scheme: dark) { :root { --bg: #101828; --surface: #1d2939; --text: #f2f4f7; --muted: #98a2b3; --border: #475467; --pass: #6ce9a6; --pass-bg: #054f31; --fail: #fda29b; --fail-bg: #7a271a; --warning: #fec84b; --warning-bg: #7a2e0e; --info: #84caff; --info-bg: #194185; } }
		@media (max-width: 640px) { main { width: min(100% - 16px, 1200px); margin: 8px auto; } .report-header, section { padding: 18px; border-radius: 10px; } th, td { padding: 9px 8px; } }
		@media print { :root { --bg: #fff; --surface: #fff; --text: #000; --muted: #444; --border: #bbb; } body { background: #fff; font-size: 11px; } main { width: 100%; margin: 0; } .report-header, section { box-shadow: none; break-inside: avoid; } }
	</style>
</head>
<body>
	<main>
		<header class="report-header">
			<p class="eyebrow">KeyLint report</p>
			<h1>${escapeHtml(projectName(result.projectRoot), context)}</h1>
			<span class="status">${escapeHtml(status, context)}</span>
			<dl class="metadata">
				<div><dt>Adapter</dt><dd>${escapeHtml(result.adapterId, context)}</dd></div>
				<div><dt>Started</dt><dd><time datetime="${escapeHtml(result.startedAt, context)}">${escapeHtml(result.startedAt, context)}</time></dd></div>
				<div><dt>Finished</dt><dd><time datetime="${escapeHtml(result.finishedAt, context)}">${escapeHtml(result.finishedAt, context)}</time></dd></div>
				<div><dt>Duration</dt><dd>${escapeHtml(result.durationMs, context)} ms</dd></div>
				${typeof baseLocale === 'string' ? `<div><dt>Base locale</dt><dd>${escapeHtml(baseLocale, context)}</dd></div>` : ''}
				${configPath ? `<div><dt>Configuration</dt><dd><code>${escapeHtml(configPath, context)}</code></dd></div>` : ''}
			</dl>
		</header>

		<section aria-labelledby="summary-heading">
			<h2 id="summary-heading">Summary</h2>
			<div class="table-wrap">
				<table class="metrics">
					<tbody>
						${metricRow('Translation keys', result.summary.totalKeys, context)}
						${metricRow('Total findings', result.summary.totalFindings, context)}
						${metricRow('Used', result.summary.used, context)}
						${metricRow('Missing in language', result.summary.missingInLanguage, context)}
						${metricRow('Unused', result.summary.unused, context)}
						${metricRow('Extra in language', result.summary.extraInLanguage, context)}
						${metricRow('Dynamic / uncertain', result.summary.dynamicOrUncertain, context)}
						${metricRow('Indirect uncertain', result.summary.indirectUncertain, context)}
						${metricRow('Missing placeholder parameters', result.summary.placeholderMissing ?? 0, context)}
						${metricRow('Placeholder locale mismatches', result.summary.placeholderMismatch ?? 0, context)}
						${metricRow('Uncertain placeholder parameters', result.summary.placeholderUncertain ?? 0, context)}
						${metricRow('Errors', context.counts.error, context)}
						${metricRow('Warnings', context.counts.warning, context)}
						${metricRow('Info', context.counts.info, context)}
					</tbody>
				</table>
			</div>
			<p><strong>Thresholds:</strong> errors ${escapeHtml(context.thresholds.maxErrors, context)}, warnings ${escapeHtml(maxWarnings, context)}</p>
		</section>

		<section aria-labelledby="findings-heading">
			<h2 id="findings-heading">Findings (${escapeHtml(findings.length, context)})</h2>
			<div class="table-wrap">
				<table class="findings-table">
					<colgroup>
						<col class="col-severity">
						<col class="col-status">
						<col class="col-key">
						<col class="col-locale">
						<col class="col-message">
						<col class="col-location">
					</colgroup>
					<thead><tr><th scope="col">Severity</th><th scope="col">Status</th><th scope="col">Key</th><th scope="col">Locale</th><th scope="col">Message</th><th scope="col">Location</th></tr></thead>
					<tbody>${findingRows}</tbody>
				</table>
			</div>
		</section>

		${context.warnings.length > 0 ? `<section aria-labelledby="warnings-heading"><h2 id="warnings-heading">Scan warnings</h2><ul>${warningItems}</ul></section>` : ''}
	</main>
</body>
</html>
`;
	}
};
