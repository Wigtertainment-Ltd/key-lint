# Changelog

All notable changes to KeyLint are documented in this file.

## Unreleased

### Added

- Added the self-contained `html` CLI reporter with a responsive stakeholder
  dashboard, search, filters, sorting, expandable evidence and placeholder
  details, print styling, and light/dark color-scheme support.
- Added `html-report` and `site-directory` outputs to the GitHub Action. The
  directly publishable site is generated at `keylint-report/site/index.html`,
  separately from the private JSON and Markdown reports.
- Added guarded publishing examples for GitHub Pages, Amazon S3, Netlify,
  GitLab CI, Azure DevOps, Jenkins, and provider-neutral static hosting.

### Security

- HTML reports omit absolute project roots, translation values, and source
  snippets while retaining reporter-wide credential redaction.
- Publishing examples deploy only the public site directory, keep hosting
  credentials outside KeyLint, and skip publication when no HTML report exists.

### Compatibility

- Existing CLI reporters, arguments, GitHub Action inputs, and Action outputs
  remain supported. HTML reporting and publishing outputs are additive.
- Threshold failures with exit code `1` leave generated reports available for
  publication. Runtime or configuration failures with exit code `2` may finish
  without an HTML report and must not publish an empty site.
