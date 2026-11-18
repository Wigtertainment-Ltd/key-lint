# Contributing to KeyLint

Use this guide to develop, test and release KeyLint. For scanning your own
project, start with the [README](README.md) or [CLI reference](packages/cli/README.md).

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).

## Reporting bugs and requesting features

Use [GitHub Issues](https://github.com/Wigtertainment-Ltd/key-lint/issues) and the
matching template. Report security vulnerabilities privately through
[SECURITY.md](SECURITY.md).

## Development setup

- Node.js 26 LTS is recommended.
- npm >= 10 is required for this npm workspace.
- Use the native target OS to package desktop releases: Windows, macOS or Linux.

```bash
npm ci
npm start
```

`npm start` builds Core, starts the renderer development server at
`http://localhost:4200/`, and launches Electron. Core must be built before using
its source consumers; the root `start`, `build`, `test` and `lint` scripts handle this.

## Workspace layout

| Path | Purpose |
| --- | --- |
| `/` | Angular and Electron desktop app |
| `packages/core` | Shared scan engine, adapters, rules and configuration |
| `packages/cli` | CLI and CI integration |
| `packages/action` | GitHub Action wrapping the CLI |

Keep scan logic in Core. Desktop and CLI code should call it rather than duplicate
its rules. See the [project architecture](PROJECT_DESCRIPTION.md#architecture)
and [UI design reference](DESIGN.md) for more detail.

The Electron renderer is sandboxed, with context isolation enabled and Node
integration disabled. `preload.js` exposes allowlisted IPC operations; filesystem
IPC requires absolute paths, and renderer writes are limited to JSON files and 2 MB.

## Build and test

| Command | Purpose |
| --- | --- |
| `npm run build:core` | Build the shared scan engine |
| `npm run build` | Build Core and the Angular renderer |
| `npm run build:cli` | Build the CLI after Core is built |
| `npm run test:packages` | Build Core and run Core, CLI, Action and Electron tests |
| `npm test` | Build Core and run desktop Karma/Jasmine tests |
| `npm run lint` | Build Core and lint desktop, Core, CLI and Action code |

For CI-style desktop tests:

```bash
npm test -- --watch=false --browsers=ChromeHeadless
```

Every bug fix needs a regression test; new adapters and rules need tests in the
corresponding package. Fix lint warnings as well as errors.

Every regular expression must have an English explanation directly at its definition,
including small validation and replacement patterns. Use a semantic constant with a
short JSDoc comment for reusable expressions and an adjacent comment for local ones.
Complex recognition patterns must additionally document representative examples,
capture groups, dynamic portions and intentional boundaries, with positive and negative
tests where applicable. Take care when sharing expressions with the `g` flag because
`exec()` and `test()` mutate their `lastIndex` state.

## Pull requests

1. Create an English branch name from `main`, using your own initials as the
   prefix: `<INITIALS>/<short-description>`. Include the actual project issue or
   ticket identifier when applicable.
2. Keep each pull request focused and follow the agreed review workflow.
3. Run the relevant build, lint and test checks.
4. Write commit messages and pull request titles using Conventional Commits:
   `feat(cli): add report filters` or `fix(cli): correct locale selection`.
   When referencing a ticket, place its actual project identifier after the colon
   and before the description.
5. Write the pull request title and description in English, complete the
   [template](.github/pull_request_template.md), and link the related issue or ticket.

Match the existing formatting and keep arguments on one line when they fit the
project's line width. Follow the repository's formatter configuration without
reformatting unrelated code.

## Desktop packaging

[package.json](package.json) defines the build scripts; [electron-builder.yml](electron-builder.yml)
configures packaging. Outputs are written to `release/`.

| Script | Output |
| --- | --- |
| `npm run build:electron` | Core and production renderer with Electron's local base URL |
| `npm run pack:win` | Unpacked Windows x64 app |
| `npm run dist:win` | Windows x64 NSIS installer, portable executable and update metadata |
| `npm run pack:mac` | Unpacked macOS Universal app |
| `npm run dist:mac` | macOS Universal DMG, ZIP and update metadata |
| `npm run pack:linux` | Unpacked Linux x64 app |
| `npm run dist:linux` | Linux x64 AppImage, DEB and update metadata |

Production Windows builds require Azure Trusted Signing. macOS builds require a
Developer ID certificate, hardened runtime and Apple notarization. Contributor
pull requests do not need publishing credentials.

Known packaging limitations:

- SmartScreen warnings can persist while a new Windows release gains reputation.
- Local Windows builds may require Developer Mode to extract signing tools that
  contain symbolic links.
- Linux packages target x64; ARM64, RPM, Snap and Flatpak are not included.
- Desktop packages are not distributed through app stores or Homebrew.

## Releases

Maintainers control version bumps, tags, publication and signing. Do not change
versions in a feature pull request unless explicitly asked.

### Desktop releases

1. Update the root version and lockfile.
2. Push the matching `v*` tag, for example `v1.5.0`.
3. The [desktop workflow](.github/workflows/release-desktop.yml) tests the project,
   builds on Windows, macOS and Linux, checks the packages, generates
   `SHA256SUMS.txt`, and attests the release assets.
4. Review the resulting GitHub draft release and publish it explicitly.

Manual workflow runs select the Windows signing profile and whether to run tests;
check the workflow inputs before dispatching a release.

The desktop workflow reads these repository secrets:

| Platform | Secret names |
| --- | --- |
| Windows | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TRUSTED_SIGNING_ENDPOINT`, `AZURE_CODE_SIGNING_ACCOUNT_NAME`, `AZURE_CERTIFICATE_PROFILE_NAME` |
| Windows test profile | `AZURE_CERTIFICATE_PROFILE_NAME_TEST` replaces the production certificate profile |
| macOS | `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |

`MAC_CSC_LINK` contains the base64-encoded `.p12` certificate and private key;
`MAC_CSC_KEY_PASSWORD` is its export password. Use an app-specific password for
`APPLE_APP_SPECIFIC_PASSWORD`. Keep all values in the repository's secret store.

### CLI and container releases

The [CLI workflow](.github/workflows/release-cli.yml) runs for `cli-v*` tags or a
manual dispatch. It builds and tests Core and CLI, then publishes both packages
to npm with provenance. Align the package versions and lockfile before publishing.
The full workflow also builds and publishes the container image to GHCR.

Manual runs can select `full`, `npm-only` or `docker-only`, with an optional
Docker tag override. Check those workflow inputs before dispatching.

### Desktop auto-update

Packaged Windows, macOS and Linux apps check for updates on startup. Development
runs, CI smoke tests and the Windows portable executable skip the check. A failed
check is logged without blocking startup.

Publish the draft release and retain the platform's update metadata. macOS needs
the ZIP as well as the DMG and `latest-mac.yml`; the ZIP supplies the update payload.
No repository token is embedded in the desktop app.

## License

Contributions are licensed under [MIT](LICENSE).
