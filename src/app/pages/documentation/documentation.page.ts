import { Component } from '@angular/core';

@Component({
	selector: 'app-documentation-page',
	template: `
		<div class="documentation-shell">
			<header class="doc-header">
				<h1>i18n Analyzer Guide</h1>
				<p class="subtitle">Understand how scans work, how to read findings, and what to do next.</p>
			</header>

			<section class="doc-card">
				<h2>Quick Start</h2>
				<ol>
					<li>Open the project in the start screen and run a new analysis.</li>
					<li>Wait for the scan to complete, then select <strong>View results</strong>.</li>
					<li>Review Translation Keys and Analysis Results for missing, unused, and inconsistent entries.</li>
					<li>Use History to track what changed between scans.</li>
				</ol>
			</section>

			<div class="doc-grid">
				<article class="doc-card">
					<h2>Scan Workflow</h2>
					<ul>
						<li>Framework detection identifies the best adapter for your project.</li>
						<li>Translation files are discovered and locale content is parsed.</li>
						<li>Source code is scanned for key usage and potential mismatches.</li>
						<li>Rules evaluate the result set and produce findings with severity.</li>
					</ul>
				</article>

				<article class="doc-card">
					<h2>Result Types</h2>
					<ul>
						<li><strong>Missing key:</strong> A key is referenced in code but not present in locale files.</li>
						<li><strong>Unused key:</strong> A key exists in translations but is not referenced in source code.</li>
						<li><strong>Empty value:</strong> A key exists but has no translated text for a locale.</li>
						<li><strong>Inconsistent locale:</strong> A key is available only in a subset of locales.</li>
						<li><strong>Placeholder error:</strong> A <code>{{ placeholderExample }}</code> parameter is missing at a usage site or differs from the base locale.</li>
						<li><strong>Uncertain parameters:</strong> A variable, spread, or computed parameter object cannot be verified statically.</li>
					</ul>
				</article>
			</div>

			<section class="doc-card">
				<h2>Best Practices</h2>
				<ul>
					<li>Keep keys stable and prefer descriptive namespaces such as <code>checkout.payment.title</code>.</li>
					<li>Require every feature PR to pass an i18n scan before merge.</li>
					<li>Keep locale files sorted to reduce merge conflicts.</li>
					<li>Review scan history after large refactors to catch accidental key removals early.</li>
					<li>Keep placeholder names identical across locales and pass every base-locale placeholder at each translation call.</li>
				</ul>
			</section>

			<section class="doc-card">
				<h2>Troubleshooting</h2>
				<div class="faq-list">
					<div>
						<h3>Scan does not start</h3>
						<p>Verify project path selection and ensure adapter detection can access source files.</p>
					</div>
					<div>
						<h3>No keys detected</h3>
						<p>Check translation file discovery patterns and confirm your project uses supported key access syntax.</p>
					</div>
					<div>
						<h3>Too many unused keys</h3>
						<p>Look for dynamic key generation in code and confirm it is supported by the current adapter.</p>
					</div>
				</div>
			</section>
		</div>
	`,
	styles: [
		`
			:host {
				display: block;
				color: var(--analysis-text);
				font-family: var(--sans);
			}

			.documentation-shell {
				display: grid;
				gap: 1rem;
				max-width: 1050px;
				margin-inline: auto;
				padding-block: 0.5rem;
			}

			.doc-header {
				margin-bottom: 0.5rem;
			}

			.doc-header h1 {
				margin: 0;
				font-size: 1.875rem;
				font-weight: 680;
				letter-spacing: -0.025em;
				line-height: 1.2;
			}

			.subtitle {
				margin: 0.5rem 0 0;
				color: var(--analysis-muted);
				font-size: 0.875rem;
			}

			.doc-grid {
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(min(100%, 23rem), 1fr));
				align-items: start;
				gap: 1rem;
			}

			.doc-card {
				min-width: 0;
				padding: 1rem 1.125rem;
				border: 1px solid var(--analysis-line);
				border-radius: 0.75rem;
				background: var(--analysis-panel);
			}

			.doc-card h2 {
				margin: 0;
				font-size: 1.0625rem;
				font-weight: 670;
			}

			.doc-card h3 {
				margin: 0;
				font-size: 0.875rem;
			}

			.doc-card ol,
			.doc-card ul {
				margin: 0.75rem 0 0;
				padding-inline-start: 1.25rem;
				display: grid;
				gap: 0.375rem;
			}

			.doc-card li::marker {
				color: var(--analysis-accent);
				font-weight: 650;
			}

			.doc-card li,
			.doc-card p {
				max-width: 76ch;
				color: var(--analysis-muted);
				font-size: 0.875rem;
				line-height: 1.55;
			}

			.doc-card p {
				margin: 0.25rem 0 0;
			}

			.doc-card strong {
				color: var(--analysis-text);
			}

			.doc-card code {
				padding: 0.125rem 0.25rem;
				border-radius: 0.25rem;
				background: var(--analysis-hover);
				color: var(--analysis-text);
				font: 0.8125rem var(--mono);
				overflow-wrap: anywhere;
			}

			.faq-list {
				margin-top: 0.75rem;
			}

			.faq-list > div + div {
				margin-top: 0.625rem;
				padding-top: 0.625rem;
				border-top: 1px solid var(--analysis-line);
			}
		`
	]
})
export class DocumentationPage {
	readonly placeholderExample: string = '{{name}}';
}
