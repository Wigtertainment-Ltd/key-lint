import { createHash } from 'node:crypto';
import { basename, isAbsolute, relative, resolve } from 'node:path';

import { IFinding, FindingSeverity, FindingStatus, IProjectScanResult, normalizePath, IFileEvidence } from '@key-lint/core';
import { redactReporterText, severityRank } from './reporter.js';
import type { IReporter, IReporterContext } from './reporter.interfaces.js';

const DASHBOARD_SCRIPT = `(() => {
	'use strict';
	const table = document.querySelector('.findings-table');
	const body = table?.tBodies[0];
	const search = document.querySelector('#finding-search');
	const severity = document.querySelector('#severity-filter');
	const status = document.querySelector('#status-filter');
	const locale = document.querySelector('#locale-filter');
	const count = document.querySelector('#finding-count');
	const reset = document.querySelector('#reset-filters');
	if (!table || !body || !search || !severity || !status || !locale || !count || !reset) return;

	const rows = Array.from(body.querySelectorAll('.finding'));
	const sortButtons = Array.from(table.querySelectorAll('[data-sort]'));
	const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
	let sortKey = 'index';
	let sortDirection = 1;

	const applyFilters = () => {
		const query = search.value.trim().toLocaleLowerCase();
		let visible = 0;
		for (const row of rows) {
			const localeMatches = locale.value === 'all'
				|| (locale.value === '__none__' ? row.dataset.locale === '' : row.dataset.locale === locale.value);
			const matches = (severity.value === 'all' || row.dataset.severity === severity.value)
				&& (status.value === 'all' || row.dataset.status === status.value)
				&& localeMatches
				&& (!query || row.textContent.toLocaleLowerCase().includes(query));
			row.hidden = !matches;
			if (matches) visible += 1;
		}
		count.textContent = 'Showing ' + visible + ' of ' + rows.length + ' findings';
	};

	const sortRows = () => {
		rows.sort((left, right) => {
			const dataKey = 'sort' + sortKey[0].toUpperCase() + sortKey.slice(1);
			const leftValue = left.dataset[dataKey] ?? '';
			const rightValue = right.dataset[dataKey] ?? '';
			const comparison = sortKey === 'severity' || sortKey === 'index'
				? Number(leftValue) - Number(rightValue)
				: collator.compare(leftValue, rightValue);
			return comparison * sortDirection;
		});
		for (const row of rows) body.append(row);
	};

	for (const control of [search, severity, status, locale]) {
		control.addEventListener(control === search ? 'input' : 'change', applyFilters);
	}
	for (const button of sortButtons) {
		button.addEventListener('click', () => {
			const nextKey = button.dataset.sort;
			sortDirection = sortKey === nextKey ? sortDirection * -1 : 1;
			sortKey = nextKey;
			for (const candidate of sortButtons) {
				candidate.closest('th')?.setAttribute('aria-sort', candidate === button
					? (sortDirection === 1 ? 'ascending' : 'descending')
					: 'none');
			}
			sortRows();
		});
	}
	reset.addEventListener('click', () => {
		search.value = '';
		severity.value = 'all';
		status.value = 'all';
		locale.value = 'all';
		sortKey = 'index';
		sortDirection = 1;
		for (const candidate of sortButtons) candidate.closest('th')?.setAttribute('aria-sort', 'none');
		sortRows();
		applyFilters();
		search.focus();
	});

	severity.value = table.dataset.defaultSeverity || 'all';
	sortRows();
	applyFilters();
})();`;

const STATUS_GUIDE: readonly { status: FindingStatus; severity: FindingSeverity; description: string; }[] = [
	{
		status: 'used',
		severity: 'info',
		description: 'The key is referenced by a translation pattern that KeyLint can resolve statically.'
	},
	{
		status: 'unused',
		severity: 'warning',
		description: 'The key exists in the translation files but no confirmed usage was found. Check dynamic usage before removing it.'
	},
	{
		status: 'dynamic-uncertain',
		severity: 'warning',
		description: 'A dynamic translation expression may use this key, but the final key cannot be confirmed without running the application.'
	},
	{
		status: 'indirect-uncertain',
		severity: 'warning',
		description: 'The key appears as a string literal, but not in a directly recognized translation call or template binding.'
	},
	{
		status: 'missing-in-language',
		severity: 'error',
		description: 'The key is used or defined in the base locale but is missing from one or more required locale files.'
	},
	{
		status: 'extra-in-language',
		severity: 'warning',
		description: 'The key exists in another locale but not in the configured base locale.'
	},
	{
		status: 'placeholder-missing',
		severity: 'error',
		description: 'A translation requires placeholder parameters that are not supplied at the usage location.'
	},
	{
		status: 'placeholder-uncertain',
		severity: 'warning',
		description: 'The supplied placeholder parameters are dynamic, so KeyLint cannot confirm that every required value is present.'
	},
	{
		status: 'placeholder-mismatch',
		severity: 'error',
		description: 'A locale uses a different set of placeholders than the configured base locale.'
	}
];

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
	const resolvedRoot: string = resolve(projectRoot);
	const resolvedFile: string = isAbsolute(filePath) ? resolve(filePath) : resolve(resolvedRoot, filePath);
	const projectRelative: string = normalizePath(relative(resolvedRoot, resolvedFile));

	if (!projectRelative) {
		return '.';
	}

	if (isOutsideProject(projectRelative)) {
		return `external/${basename(resolvedFile)}`;
	}

	return projectRelative;
}

function stripProjectRoot(value: string, projectRoot: string): string {
	const candidates: string[] = [
		...new Set([
			projectRoot,
			resolve(projectRoot),
			normalizePath(projectRoot),
			normalizePath(resolve(projectRoot))
		])
	].filter(Boolean).sort((left, right) => right.length - left.length);

	return candidates.reduce((text, candidate) => {
		let sanitized: string = text;
		let offset: number = sanitized.toLowerCase().indexOf(candidate.toLowerCase());
		while (offset >= 0) {
			sanitized = `${sanitized.slice(0, offset)}.${sanitized.slice(offset + candidate.length)}`;
			offset = sanitized.toLowerCase().indexOf(candidate.toLowerCase(), offset + 1);
		}
		return sanitized;
	}, value);
}

function locationOf(finding: IFinding, projectRoot: string): string {
	const evidence: IFileEvidence = finding.evidence[0];
	if (!evidence) {
		return '-';
	}

	const path: string = displayPath(projectRoot, evidence.filePath);
	if (evidence.line === undefined) {
		return path;
	}

	return evidence.column === undefined
		? `${path}:${evidence.line}`
		: `${path}:${evidence.line}:${evidence.column}`;
}

function thresholdStatus(context: IReporterContext): 'passed' | 'failed' {
	const warningsExceeded: boolean = context.thresholds.maxWarnings >= 0
		&& context.counts.warning > context.thresholds.maxWarnings;
	return context.counts.error > context.thresholds.maxErrors || warningsExceeded ? 'failed' : 'passed';
}

function metricCard(label: string, value: number, context: IReporterContext, tone = ''): string {
	return `<div class="metric${tone ? ` metric--${tone}` : ''}"><dt>${escapeHtml(label, context)}</dt><dd>${escapeHtml(value, context)}</dd></div>`;
}

function option(value: string, label: string, context: IReporterContext): string {
	return `<option value="${escapeHtml(value, context)}">${escapeHtml(label, context)}</option>`;
}

function statusGuide(context: IReporterContext): string {
	return STATUS_GUIDE.map((item) => `
				<div class="status-guide-item">
					<div class="status-guide-heading"><code>${escapeHtml(item.status, context)}</code><span class="badge badge--${item.severity}">${item.severity}</span></div>
					<p>${escapeHtml(item.description, context)}</p>
				</div>`).join('');
}

function evidenceDetails(finding: IFinding, result: IProjectScanResult, context: IReporterContext): string {
	if (finding.evidence.length === 0) {
		return '';
	}

	const items: string = finding.evidence.map((evidence) => {
		const location: string = locationOf({ ...finding, evidence: [evidence] }, result.projectRoot);
		const matchType: string = evidence.matchType
			? ` <span class="detail-meta">(${escapeHtml(evidence.matchType, context)})</span>`
			: '';
		return `<li><code>${escapeHtml(location, context)}</code>${matchType}</li>`;
	}).join('');

	return `<div><strong>Evidence</strong><ul>${items}</ul></div>`;
}

function placeholderDetails(finding: IFinding, context: IReporterContext): string {
	if (!finding.placeholderDetails) {
		return '';
	}

	const entries: [string, string[] | undefined][] = [
		['Required', finding.placeholderDetails.required],
		['Provided', finding.placeholderDetails.provided],
		['Missing', finding.placeholderDetails.missing],
		['Expected', finding.placeholderDetails.expected],
		['Actual', finding.placeholderDetails.actual]
	];
	const rows: string = entries
		.filter((entry): entry is [string, string[]] => entry[1] !== undefined)
		.map(([label, values]) => `<div><dt>${escapeHtml(label, context)}</dt><dd>${values.length > 0
			? values.map((value) => `<code>${escapeHtml(value, context)}</code>`).join(', ')
			: '<span class="detail-meta">none</span>'}</dd></div>`)
		.join('');

	return `<div><strong>Placeholders</strong><dl class="placeholder-details">${rows}</dl></div>`;
}

function findingDetails(finding: IFinding, result: IProjectScanResult, context: IReporterContext): string {
	const details: string = `${evidenceDetails(finding, result, context)}${placeholderDetails(finding, context)}`;
	if (!details) {
		return '<span class="detail-meta">No details</span>';
	}

	return `<details><summary>View details</summary><div class="details-content">${details}</div></details>`;
}

function findingRow(finding: IFinding, index: number, result: IProjectScanResult, context: IReporterContext): string {
	const locale: string = finding.language ?? '';
	const message: string = stripProjectRoot(finding.message, result.projectRoot);
	const location: string = locationOf(finding, result.projectRoot);
	return [
		`<tr class="finding finding--${escapeHtml(finding.severity, context)}"`,
		` data-severity="${escapeHtml(finding.severity, context)}"`,
		` data-status="${escapeHtml(finding.status, context)}"`,
		` data-locale="${escapeHtml(locale.toLocaleLowerCase(), context)}"`,
		` data-sort-index="${index}"`,
		` data-sort-severity="${severityRank(finding.severity)}"`,
		` data-sort-status="${escapeHtml(finding.status, context)}"`,
		` data-sort-key="${escapeHtml(finding.key, context)}"`,
		` data-sort-locale="${escapeHtml(locale, context)}"`,
		` data-sort-message="${escapeHtml(message, context)}"`,
		` data-sort-location="${escapeHtml(location, context)}">`,
		`<td><span class="badge badge--${escapeHtml(finding.severity, context)}">${escapeHtml(finding.severity, context)}</span></td>`,
		`<td>${escapeHtml(finding.status, context)}</td>`,
		`<td><code>${escapeHtml(finding.key, context)}</code></td>`,
		`<td>${escapeHtml(locale || '-', context)}</td>`,
		`<td>${escapeHtml(message, context)}</td>`,
		`<td><code>${escapeHtml(location, context)}</code></td>`,
		`<td>${findingDetails(finding, result, context)}</td>`,
		'</tr>'
	].join('');
}

export const htmlReporter: IReporter = {
	name: 'html',
	format(result: IProjectScanResult, context: IReporterContext): string {
		const status: 'passed' | 'failed' = thresholdStatus(context);
		const baseLocale: unknown = result.metadata?.['baseLocale'];
		const findings: IFinding[] = [...result.findings].sort((left, right) =>
			severityRank(left.severity) - severityRank(right.severity)
			|| left.key.localeCompare(right.key)
			|| left.id.localeCompare(right.id)
		);
		const defaultSeverity: 'warning' | 'error' | 'all' = findings.some((finding) => finding.severity === 'error')
			? 'error'
			: findings.some((finding) => finding.severity === 'warning') ? 'warning' : 'all';
		const findingRows: string = findings.length > 0
			? findings.map((finding, index) => findingRow(finding, index, result, context)).join('\n')
			: '<tr><td colspan="7" class="empty">No findings.</td></tr>';
		const statuses: FindingStatus[] = [...new Set(findings.map((finding) => finding.status))].sort();
		const locales: string[] = [...new Set(findings.map((finding) => finding.language).filter((value): value is string => Boolean(value)))]
			.sort((left, right) => left.localeCompare(right));
		const hasFindingsWithoutLocale: boolean = findings.some((finding) => !finding.language);
		const warningItems: string = context.warnings
			.map((warning) => `<li>${escapeHtml(stripProjectRoot(warning, result.projectRoot), context)}</li>`)
			.join('\n');
		const configPath: string | undefined = context.configFilePath
			? displayPath(result.projectRoot, context.configFilePath)
			: undefined;
		const maxWarnings: string = context.thresholds.maxWarnings < 0
			? 'unlimited'
			: String(context.thresholds.maxWarnings);
		const scriptHash: string = createHash('sha256').update(DASHBOARD_SCRIPT).digest('base64');

		return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${scriptHash}'; base-uri 'none'; form-action 'none'">
	<title>KeyLint report - ${escapeHtml(projectName(result.projectRoot), context)}</title>
	<style>
		:root { color-scheme: light dark; --bg: #f5f7fb; --surface: #fff; --surface-alt: #f9fafb; --text: #182230; --muted: #667085; --border: #d0d5dd; --focus: #1570ef; --pass: #067647; --pass-bg: #ecfdf3; --fail: #b42318; --fail-bg: #fef3f2; --warning: #b54708; --warning-bg: #fffaeb; --info: #175cd3; --info-bg: #eff8ff; }
		* { box-sizing: border-box; }
		body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
		main { width: min(1440px, calc(100% - 32px)); margin: 32px auto; }
		h1, h2 { line-height: 1.2; }
		h1 { margin: 0; font-size: clamp(1.75rem, 4vw, 2.5rem); }
		h2 { margin: 0; font-size: 1.25rem; }
		code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
		.report-header, section { margin-bottom: 24px; padding: 24px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); box-shadow: 0 1px 3px rgb(16 24 40 / 8%); }
		.report-header { border-left: 8px solid var(--${status === 'passed' ? 'pass' : 'fail'}); }
		.section-heading { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px 16px; margin-bottom: 16px; }
		.eyebrow { margin: 0 0 8px; color: var(--muted); font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
		.status { display: inline-block; margin-top: 16px; padding: 5px 10px; border-radius: 999px; color: var(--${status === 'passed' ? 'pass' : 'fail'}); background: var(--${status === 'passed' ? 'pass' : 'fail'}-bg); font-weight: 800; text-transform: uppercase; }
		.metadata { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px 24px; margin: 20px 0 0; }
		.metadata div { min-width: 0; }
		dt { color: var(--muted); font-size: .82rem; font-weight: 700; text-transform: uppercase; }
		dd { margin: 2px 0 0; overflow-wrap: anywhere; }
		.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); gap: 12px; margin: 0; }
		.metric { min-width: 0; padding: 14px 16px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-alt); }
		.metric dd { font-size: 1.45rem; font-weight: 750; font-variant-numeric: tabular-nums; }
		.metric--error { border-color: var(--fail); background: var(--fail-bg); }
		.metric--warning { border-color: var(--warning); background: var(--warning-bg); }
		.thresholds { margin: 16px 0 0; }
		.introduction { margin: 0; max-width: 90ch; color: var(--muted); font-size: 1rem; }
		.result-explanation { margin: 12px 0 0; }
		.status-guide { display: grid; grid-template-columns: repeat(auto-fit, minmax(270px, 1fr)); gap: 12px; }
		.status-guide-item { padding: 14px 16px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-alt); }
		.status-guide-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
		.status-guide-heading code { font-weight: 750; }
		.status-guide-item p { margin: 8px 0 0; color: var(--muted); }
		.toolbar { display: grid; grid-template-columns: minmax(220px, 2fr) repeat(3, minmax(140px, 1fr)) auto; gap: 12px; align-items: end; margin-bottom: 12px; padding: 16px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-alt); }
		.control { display: grid; gap: 4px; min-width: 0; }
		.control label { color: var(--muted); font-size: .78rem; font-weight: 700; text-transform: uppercase; }
		input, select, button { min-height: 40px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); color: var(--text); font: inherit; }
		input, select { width: 100%; padding: 7px 10px; }
		button { padding: 7px 12px; cursor: pointer; font-weight: 700; }
		input:focus-visible, select:focus-visible, button:focus-visible, summary:focus-visible { outline: 3px solid color-mix(in srgb, var(--focus) 35%, transparent); outline-offset: 1px; }
		.result-summary { margin: 0 0 12px; color: var(--muted); }
		.table-wrap { overflow-x: auto; }
		table { width: 100%; border-collapse: collapse; }
		th, td { padding: 11px 12px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
		th { font-size: .82rem; letter-spacing: .03em; text-transform: uppercase; }
		tbody tr:last-child th, tbody tr:last-child td { border-bottom: 0; }
		.findings-table { min-width: 1320px; table-layout: fixed; }
		.findings-table thead th { position: sticky; top: 0; z-index: 1; background: var(--surface); }
		.findings-table .col-severity { width: 105px; }
		.findings-table .col-status { width: 145px; }
		.findings-table .col-key { width: 220px; }
		.findings-table .col-locale { width: 75px; }
		.findings-table .col-message { width: 335px; }
		.findings-table .col-location { width: 220px; }
		.findings-table .col-details { width: 220px; }
		.findings-table code { overflow-wrap: break-word; word-break: normal; }
		.sort-button { display: inline-flex; min-height: 0; padding: 2px 4px; border: 0; background: transparent; color: inherit; font-size: inherit; letter-spacing: inherit; text-transform: inherit; }
		.sort-button::after { content: ' ↕'; color: var(--muted); }
		th[aria-sort="ascending"] .sort-button::after { content: ' ↑'; }
		th[aria-sort="descending"] .sort-button::after { content: ' ↓'; }
		.badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: .78rem; font-weight: 800; text-transform: uppercase; }
		.badge--error { color: var(--fail); background: var(--fail-bg); }
		.badge--warning { color: var(--warning); background: var(--warning-bg); }
		.badge--info { color: var(--info); background: var(--info-bg); }
		details summary { cursor: pointer; font-weight: 700; }
		.details-content { display: grid; gap: 12px; margin-top: 8px; }
		.details-content ul { margin-top: 4px; }
		.detail-meta { color: var(--muted); }
		.placeholder-details { display: grid; gap: 6px; margin: 4px 0 0; }
		.empty { color: var(--muted); text-align: center; }
		ul { margin: 0; padding-left: 22px; }
		[hidden] { display: none !important; }
		@media (prefers-color-scheme: dark) { :root { --bg: #101828; --surface: #1d2939; --surface-alt: #182230; --text: #f2f4f7; --muted: #98a2b3; --border: #475467; --focus: #53b1fd; --pass: #6ce9a6; --pass-bg: #054f31; --fail: #fda29b; --fail-bg: #7a271a; --warning: #fec84b; --warning-bg: #7a2e0e; --info: #84caff; --info-bg: #194185; } }
		@media (max-width: 1000px) { .toolbar { grid-template-columns: repeat(2, minmax(0, 1fr)); } .control--search { grid-column: 1 / -1; } }
		@media (max-width: 640px) { main { width: min(100% - 16px, 1440px); margin: 8px auto; } .report-header, section { padding: 18px; border-radius: 10px; } .toolbar { grid-template-columns: 1fr; } .control--search { grid-column: auto; } th, td { padding: 9px 8px; } }
		@media print { :root { --bg: #fff; --surface: #fff; --surface-alt: #fff; --text: #000; --muted: #444; --border: #bbb; } body { background: #fff; font-size: 10px; } main { width: 100%; margin: 0; } .report-header, section { padding: 12px; box-shadow: none; } .toolbar, .result-summary, noscript { display: none; } .findings-table { min-width: 100%; table-layout: auto; } .findings-table thead th { position: static; } .sort-button { padding: 0; } .sort-button::after { content: ''; } details:not([open]) > *:not(summary) { display: block; } details summary { display: none; } }
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

		<section aria-labelledby="introduction-heading">
			<div class="section-heading"><h2 id="introduction-heading">About this report</h2></div>
			<p class="introduction">This report summarizes how translation keys are defined and used across the project. Start with errors that require action, then review warnings where KeyLint needs confirmation. Informational findings show confirmed usage.</p>
			<p class="result-explanation"><strong>Overall result:</strong> ${status === 'passed'
				? 'The scan stayed within the configured error and warning thresholds.'
				: 'The scan exceeded at least one configured error or warning threshold.'}</p>
		</section>

		<section aria-labelledby="status-guide-heading">
			<div class="section-heading"><h2 id="status-guide-heading">Status guide</h2></div>
			<div class="status-guide">
				${statusGuide(context)}
			</div>
		</section>

		<section aria-labelledby="summary-heading">
			<div class="section-heading"><h2 id="summary-heading">Summary</h2></div>
			<dl class="metrics">
				${metricCard('Translation keys', result.summary.totalKeys, context)}
				${metricCard('Total findings', result.summary.totalFindings, context)}
				${metricCard('Errors', context.counts.error, context, 'error')}
				${metricCard('Warnings', context.counts.warning, context, 'warning')}
				${metricCard('Info', context.counts.info, context)}
				${metricCard('Used', result.summary.used, context)}
				${metricCard('Missing in language', result.summary.missingInLanguage, context)}
				${metricCard('Unused', result.summary.unused, context)}
				${metricCard('Extra in language', result.summary.extraInLanguage, context)}
				${metricCard('Dynamic / uncertain', result.summary.dynamicOrUncertain, context)}
				${metricCard('Indirect uncertain', result.summary.indirectUncertain, context)}
				${metricCard('Missing placeholder parameters', result.summary.placeholderMissing ?? 0, context)}
				${metricCard('Placeholder locale mismatches', result.summary.placeholderMismatch ?? 0, context)}
				${metricCard('Uncertain placeholder parameters', result.summary.placeholderUncertain ?? 0, context)}
			</dl>
			<p class="thresholds"><strong>Thresholds:</strong> errors ${escapeHtml(context.thresholds.maxErrors, context)}, warnings ${escapeHtml(maxWarnings, context)}</p>
		</section>

		<section aria-labelledby="findings-heading">
			<div class="section-heading"><h2 id="findings-heading">Findings (${escapeHtml(findings.length, context)})</h2></div>
			<div class="toolbar" aria-label="Finding filters">
				<div class="control control--search"><label for="finding-search">Search</label><input id="finding-search" type="search" placeholder="Key, message, locale or path"></div>
				<div class="control"><label for="severity-filter">Severity</label><select id="severity-filter">${option('all', 'All severities', context)}${option('error', 'Error', context)}${option('warning', 'Warning', context)}${option('info', 'Info', context)}</select></div>
				<div class="control"><label for="status-filter">Status</label><select id="status-filter">${option('all', 'All statuses', context)}${statuses.map((value) => option(value, value, context)).join('')}</select></div>
				<div class="control"><label for="locale-filter">Locale</label><select id="locale-filter">${option('all', 'All locales', context)}${hasFindingsWithoutLocale ? option('__none__', 'No locale', context) : ''}${locales.map((value) => option(value.toLocaleLowerCase(), value, context)).join('')}</select></div>
				<button id="reset-filters" type="button">Reset</button>
			</div>
			<p id="finding-count" class="result-summary" role="status" aria-live="polite">Showing ${escapeHtml(findings.length, context)} of ${escapeHtml(findings.length, context)} findings</p>
			<noscript><p class="result-summary">JavaScript is disabled. All findings remain available below; interactive filters and sorting are unavailable.</p></noscript>
			<div class="table-wrap">
				<table class="findings-table" data-default-severity="${defaultSeverity}">
					<colgroup>
						<col class="col-severity">
						<col class="col-status">
						<col class="col-key">
						<col class="col-locale">
						<col class="col-message">
						<col class="col-location">
						<col class="col-details">
					</colgroup>
					<thead><tr><th scope="col" aria-sort="none"><button class="sort-button" type="button" data-sort="severity">Severity</button></th><th scope="col" aria-sort="none"><button class="sort-button" type="button" data-sort="status">Status</button></th><th scope="col" aria-sort="none"><button class="sort-button" type="button" data-sort="key">Key</button></th><th scope="col" aria-sort="none"><button class="sort-button" type="button" data-sort="locale">Locale</button></th><th scope="col" aria-sort="none"><button class="sort-button" type="button" data-sort="message">Message</button></th><th scope="col" aria-sort="none"><button class="sort-button" type="button" data-sort="location">Location</button></th><th scope="col">Details</th></tr></thead>
					<tbody>${findingRows}</tbody>
				</table>
			</div>
		</section>

		${context.warnings.length > 0 ? `<section aria-labelledby="warnings-heading"><div class="section-heading"><h2 id="warnings-heading">Scan warnings</h2></div><ul>${warningItems}</ul></section>` : ''}
	</main>
	<script>${DASHBOARD_SCRIPT}</script>
</body>
</html>
`;
	}
};
