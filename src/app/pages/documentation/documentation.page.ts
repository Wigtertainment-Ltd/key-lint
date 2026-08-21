import { Component } from '@angular/core';

@Component({
	selector: 'app-documentation-page',
	template: `
		<main class="documentation-shell">
			<header class="doc-header">
				<p class="eyebrow">Documentation</p>
				<h2>i18n Analyzer Guide</h2>
				<p class="subtitle">Understand how scans work, how to read findings, and what to do next.</p>
			</header>

			<section class="doc-card">
				<h3>Quick Start</h3>
				<ol>
					<li>Open the project in the start screen and run a new analysis.</li>
					<li>Wait until the dashboard reaches 100% and scan state shows completed.</li>
					<li>Review Translation Keys and Analysis Results for missing, unused, and inconsistent entries.</li>
					<li>Use History to track what changed between scans.</li>
				</ol>
			</section>

			<section class="doc-grid">
				<article class="doc-card">
					<h3>Scan Workflow</h3>
					<ul>
						<li>Framework detection identifies the best adapter for your project.</li>
						<li>Translation files are discovered and locale content is parsed.</li>
						<li>Source code is scanned for key usage and potential mismatches.</li>
						<li>Rules evaluate the result set and produce findings with severity.</li>
					</ul>
				</article>

				<article class="doc-card">
					<h3>Result Types</h3>
					<ul>
						<li><strong>Missing key:</strong> A key is referenced in code but not present in locale files.</li>
						<li><strong>Unused key:</strong> A key exists in translations but is not referenced in source code.</li>
						<li><strong>Empty value:</strong> A key exists but has no translated text for a locale.</li>
						<li><strong>Inconsistent locale:</strong> A key is available only in a subset of locales.</li>
						<li><strong>Placeholder error:</strong> A <code>{{ placeholderExample }}</code> parameter is missing at a usage site or differs from the base locale.</li>
						<li><strong>Uncertain parameters:</strong> A variable, spread, or computed parameter object cannot be verified statically.</li>
					</ul>
				</article>
			</section>

			<section class="doc-card">
				<h3>Best Practices</h3>
				<ul>
					<li>Keep keys stable and prefer descriptive namespaces such as <code>checkout.payment.title</code>.</li>
					<li>Require every feature PR to pass an i18n scan before merge.</li>
					<li>Keep locale files sorted to reduce merge conflicts.</li>
					<li>Review scan history after large refactors to catch accidental key removals early.</li>
					<li>Keep placeholder names identical across locales and pass every base-locale placeholder at each translation call.</li>
				</ul>
			</section>

			<section class="doc-card">
				<h3>Troubleshooting</h3>
				<div class="faq-list">
					<div>
						<h4>Scan does not start</h4>
						<p>Verify project path selection and ensure adapter detection can access source files.</p>
					</div>
					<div>
						<h4>No keys detected</h4>
						<p>Check translation file discovery patterns and confirm your project uses supported key access syntax.</p>
					</div>
					<div>
						<h4>Too many unused keys</h4>
						<p>Look for dynamic key generation in code and confirm it is supported by the current adapter.</p>
					</div>
				</div>
			</section>
		</main>
	`,
	styles: [
		`
			:host {
				display: block;
				min-height: 0;
				font-family: var(--sans);
				background: linear-gradient(180deg, var(--surface) 0%, var(--surface-container-lowest) 100%);
			}

			.documentation-shell {
				height: auto;
				min-height: 0;
				overflow: visible;
				padding: 1.25rem;
				display: grid;
				gap: 1rem;
				align-content: start;
			}

			.doc-header {
				padding: 1rem;
				border-radius: 0.75rem;
				background: var(--surface);
				border: 1px solid var(--outline-variant);
			}

			.doc-header h2 {
				margin: 0.2rem 0 0;
				font-size: 1.5rem;
				color: var(--on-surface);
			}

			.eyebrow {
				margin: 0;
				font-size: 0.75rem;
				font-weight: 700;
				letter-spacing: 0.08em;
				text-transform: uppercase;
				color: var(--primary);
			}

			.subtitle {
				margin: 0.5rem 0 0;
				color: var(--on-surface-variant);
			}

			.doc-grid {
				display: grid;
				grid-template-columns: repeat(2, minmax(0, 1fr));
				gap: 1rem;
			}

			.doc-card {
				background: var(--surface-container-lowest);
				border: 1px solid var(--outline-variant);
				border-radius: 0.75rem;
				padding: 1rem;
			}

			.doc-card h3 {
				margin: 0;
				font-size: 1.1rem;
				color: var(--on-surface);
			}

			.doc-card h4 {
				margin: 0;
				font-size: 0.95rem;
				color: var(--on-surface);
			}

			.doc-card ol,
			.doc-card ul {
				margin: 0.75rem 0 0;
				padding-left: 1.1rem;
				display: grid;
				gap: 0.4rem;
				color: var(--on-surface-variant);
			}

			.doc-card p {
				margin: 0.4rem 0 0;
				color: var(--on-surface-variant);
				line-height: 1.45;
			}

			.doc-card code {
				font-family: var(--mono);
				background: var(--surface-container-lowest);
				border: 1px solid var(--outline-variant);
				border-radius: 0.35rem;
				padding: 0.05rem 0.3rem;
			}

			.faq-list {
				display: grid;
				gap: 0.8rem;
				margin-top: 0.8rem;
			}

			@media (max-width: 860px) {
				.documentation-shell {
					padding: 0.9rem;
				}

				.doc-grid {
					grid-template-columns: 1fr;
				}
			}
		`
	]
})
export class DocumentationPage {
	readonly placeholderExample = '{{name}}';
}
