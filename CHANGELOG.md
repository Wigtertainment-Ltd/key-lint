# Changelog

All notable changes to KeyLint are documented in this file.

## [1.3.0] - 2026-08-28

Changes since `1.2.1`.

### Highlights

- Added secure, opt-in support for remote translation sources across the core library, CLI, GitHub Action and desktop app.
- Added automatic static detection of ngx-translate and Transloco HTTP loaders.
- Added placeholder contract validation for Mustache parameters such as `{{name}}`.
- Added signed desktop releases for macOS and packaged releases for Linux alongside the existing Windows downloads.

### Added

- Introduced ordered `translationSources` with `filesystem`, `http` and `auto-http` source types.
- Added recursive merging of multiple translation sources, with later sources taking precedence.
- Added remote-only project support and read-only handling for remote or mixed translation results.
- Added `--allow-network` to the CLI and `allow-network` to the GitHub Action. Network access remains disabled unless explicitly enabled at runtime.
- Added environment-based authentication headers for remote sources without persisting credentials in configuration or reports.
- Added guarded HTTP fetching with GET-only requests, timeouts, redirect and request-count limits, response-size checks, request reuse and sensitive-data redaction.
- Added static analysis for modern and legacy ngx-translate HTTP loader configurations.
- Added static analysis for Transloco loaders, providers, injected loaders and supported locale/URL patterns.
- Added desktop review and confirmation of detected endpoints, locales, warnings and temporary authentication values before remote requests run.
- Added placeholder findings:
  - `placeholder-missing` when a statically known call omits required parameters.
  - `placeholder-mismatch` when locale files define different placeholder contracts.
  - `placeholder-uncertain` when parameters cannot be resolved statically.
- Added placeholder summaries, filters and per-locale placeholder details to the desktop results and translation-key views.
- Added placeholder information to text, Markdown and JSON CLI reports.
- Added native desktop packaging commands for macOS and Linux: `pack:mac`, `dist:mac`, `pack:linux` and `dist:linux`.
- Added macOS Universal DMG and ZIP builds with Developer ID signing, hardened runtime, notarization and stapling.
- Added Linux x64 AppImage and DEB builds with desktop and icon metadata.
- Added SHA-256 checksum generation and GitHub build-provenance attestations for release downloads.
- Added packaged-app smoke tests and platform-specific validation for Windows, macOS and Linux artifacts.
- Added pull-request linting and test automation using the ESLint flat configuration.
- Added architecture and security documentation for remote translations, loader detection and cross-platform releases.

### Changed

- Upgraded the JSON reporter to schema version `2`, adding placeholder summary counters and structured `placeholderDetails`.
- Placeholder contract validation is enabled by default and uses the existing `ignoreKeys` patterns for suppression.
- Error thresholds now include definite placeholder errors in addition to missing translation keys.
- Improved desktop performance for large scans by virtualizing result and translation-key lists and caching filter calculations.
- Improved Electron startup portability by loading the packaged renderer with `BrowserWindow.loadFile()`.
- Enabled update checks for packaged Windows, macOS and Linux applications while continuing to exclude development runs, CI smoke tests and the Windows portable build.
- Replaced the Windows-only release workflow with a coordinated Windows, macOS and Linux draft-release workflow.
- Standardized public artifact names to include platform and architecture.
- Updated package, CLI, Action, contribution and security documentation for the new scan and release behavior.

### Security

- Project configuration alone cannot authorize network access; every runtime requires an explicit opt-in.
- Remote credentials are supplied at runtime and excluded from reports, diagnostics and persisted desktop state.
- Sensitive headers are stripped during cross-origin redirects, and query values are redacted from diagnostics.
- Remote and mixed-source results cannot write merged values back to local translation files.
- Remote loader detection analyzes TypeScript as text and never executes project code.

### Fixed

- Fixed absolute include and exclude glob handling in the Node filesystem adapter.
- Improved remote-source error handling, metadata redaction and release hardening.
- Stabilized Linux artifact names across AppImage (`x86_64`) and DEB (`amd64`) conventions by publishing both as `linux-x64`.
- Added actionable Linux artifact verification errors and made DEB content checks safe under Bash `pipefail`.
- Fixed idempotent draft-release creation when the publish job runs without a local Git checkout.

### Compatibility notes

- Consumers that validate JSON reporter output must accept schema version `2` and the new placeholder fields.
- Existing scans may report additional errors because placeholder contract validation is enabled by default. Review `placeholder-missing` and `placeholder-mismatch` findings or suppress intentional cases with `ignoreKeys`.
- Remote translation sources do not make network requests after upgrading unless the runtime explicitly enables them.
- Linux releases currently target x64 only. Linux ARM64, RPM, Snap and Flatpak are not included.

[1.3.0]: https://github.com/Wigtertainment-Ltd/key-lint/compare/v1.2.1...v1.3.0
