# Contributing to KeyLint

Thanks for taking the time to contribute. This document describes how to get the
project running locally and what we expect from a pull request.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating
you are expected to uphold it.

## Reporting bugs and requesting features

Please use the [issue tracker](https://github.com/Wigtertainment-Ltd/key-lint/issues)
and pick the matching template. Do **not** report security vulnerabilities in a public
issue – see [SECURITY.md](SECURITY.md).

## Development setup

Requirements:

- Node.js >= 20
- npm >= 10 (the repository uses npm workspaces)
- The native target OS is recommended for packaging desktop releases: Windows for NSIS/portable,
  macOS for the universal signed/notarized DMG and Linux for AppImage/DEB

```bash
npm install
npm run build:core   # required before the Angular build and before the CLI runs
npm start            # Angular dev server + Electron shell
```

## Workspace layout

| Path | Package | Purpose |
| --- | --- | --- |
| `/` | `key-lint` | Angular + Electron desktop app |
| `packages/core` | `@key-lint/core` | Framework-agnostic scan engine |
| `packages/cli` | `@key-lint/cli` | Headless CLI for CI/CD pipelines |
| `packages/action` | - | GitHub Action wrapping the CLI |

Scan logic belongs in `@key-lint/core`. The desktop app and the CLI are thin
presentation layers on top of it – please do not duplicate rules in either of them.

## Tests

```bash
npm run test:packages   # engine + CLI (Vitest)
npm test                # desktop app (Karma/Jasmine)
npm run lint
```

Every bug fix should come with a regression test, every new rule or adapter with unit
tests in the corresponding package.

## Pull requests

1. Fork the repository and create a branch off `main`.
2. Keep the change focused – one topic per pull request.
3. Make sure `npm run lint` and the test suites pass.
4. Write commit messages in the imperative mood ("Add ...", "Fix ...").
5. Fill out the pull request template and link the related issue.

Formatting is handled by Prettier; run it before committing so reviews stay focused on
the actual change.

## Releases

Releases are cut by the maintainers. Version bumps and tags (`v*`) trigger the
workflows in `.github/workflows/`, so please do not bump versions in a pull request
unless you were asked to.

The desktop release workflow builds all three operating systems independently and publishes their
verified artifacts together as one draft GitHub release. Production packaging requires the
maintainer-managed Azure Trusted Signing and Apple Developer secrets; contributors do not need
access to them.

## License

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).
