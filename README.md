<div align="center">

<img src="public/logo.png" alt="KeyLint logo" width="128" height="128">

# KeyLint

**Find missing, unused and inconsistent translation keys in Angular and React projects.**

Review translations in the desktop app or check them in CI. Both use the same scan engine.

[Desktop app](#desktop-app) · [CLI](#command-line) · [CI pipelines](#ci-pipelines) · [Documentation](#documentation)

</div>

## What KeyLint checks

- Missing and extra translations per locale
- Unused keys and uncertain dynamic or indirect usage
- Missing placeholder parameters and inconsistent locale contracts
- Source evidence with file and line locations

## Supported projects

| Area | Support |
| --- | --- |
| Angular | ngx-translate-style usage with JSON translations |
| React | react-i18next with local JSON translations |
| Desktop | Windows x64, macOS Universal (Intel and Apple Silicon), Linux x64 |
| CLI | Node.js; Node.js 26 LTS is recommended |

Common translation directories and source files are detected automatically. Configure
custom paths and exclusions through [`keylint.config.json`](packages/cli/README.md#configuration-file).

The [React adapter reference](packages/core/src/adapters/react/README.md) covers namespaces,
`useTranslation`, explicit `<Trans i18nKey>` usage, plurals, placeholders and current limitations.

## Desktop app

1. Download the latest Windows, macOS or Linux build from
   [Releases](https://github.com/Wigtertainment-Ltd/key-lint/releases).
2. Open KeyLint and select your project folder.
3. Review the dashboard, filter findings, or compare translations in the locale matrix.
4. Add missing translations to local JSON files directly from the app.

Scan history is saved per project. Light and dark themes are included. Remote and
mixed-source results are read-only; see the [remote translation guide](docs/remote-translations.md).

## Command line

Node.js 26 LTS is recommended. Run a scan without installing KeyLint globally:

```bash
npx @key-lint/cli scan .
```

Or install the CLI once:

```bash
npm install -g @key-lint/cli
keylint scan /path/to/project --max-errors 0
```

Reporters include `text`, `json`, `markdown` and `html`. For example, write a
self-contained HTML report:

```bash
npx @key-lint/cli scan . --output html=keylint-report/site/index.html
```

Exit code `0` means thresholds passed, `1` means a threshold was exceeded, and `2`
means the run failed. Requested reports are written before a threshold failure.

See the [CLI reference](packages/cli/README.md) for options, configuration, report
formats and exit-code details.

## CI pipelines

Choose the integration for your CI provider:

| Provider | Setup | Complete example |
| --- | --- | --- |
| GitHub Actions | [Action inputs and outputs](packages/action/README.md) | [GitHub workflow](docs/ci/github-actions.yml) |
| GitLab CI | [MR comments and token setup](docs/ci/README.md#gitlab-setup) | [GitLab pipeline](docs/ci/gitlab-ci.yml) |
| Azure DevOps | [CI guide](docs/ci/README.md) | [Azure pipeline](docs/ci/azure-pipelines.yml) |
| Jenkins | [CI guide](docs/ci/README.md) | [Jenkinsfile](docs/ci/Jenkinsfile) |

### Pull request and merge request comments

Enable the built-in integration on GitHub or GitLab:

```bash
npx @key-lint/cli scan . --pr-comment
```

The CLI creates or updates one KeyLint summary comment with the result, error and
warning counts, and a link to the CI run. No helper scripts or report files are
required. Provide the CI token and permissions described in the
[comment setup guide](docs/ci/README.md#pull-request-comments).

For the GitHub Action, use [`pr-comment: 'true'`](packages/action/README.md#pull-request-comments).
Comments are disabled by default and preserve threshold failure exit codes.

### Reports and Docker

The [CI guide](docs/ci/README.md) explains artifact uploads and HTML publishing with
[GitHub Pages](docs/ci/README.md#publishing-the-report-with-github-pages),
[Amazon S3](docs/ci/README.md#publishing-to-amazon-s3) and
[Netlify](docs/ci/README.md#publishing-to-netlify).

To build and run a local container, follow the [Docker instructions](docs/ci/README.md#docker).

## Documentation

| You want to… | Read |
| --- | --- |
| Configure scanning, thresholds and reporters | [CLI reference](packages/cli/README.md) |
| Configure GitHub Actions | [Action reference](packages/action/README.md) |
| Set up another CI provider or publish reports | [CI guide and examples](docs/ci/README.md) |
| Configure HTTP sources and automatic loader detection | [Remote translation guide](docs/remote-translations.md) |
| Integrate the scan engine in another tool | [Core API guide](packages/core/README.md) |
| Check React support and limitations | [React adapter reference](packages/core/src/adapters/react/README.md) |
| Understand the application structure | [Project architecture](PROJECT_DESCRIPTION.md#architecture) |
| Develop, test or release KeyLint | [Contributing guide](CONTRIBUTING.md) |

## Contributing and support

Report bugs and request features through [GitHub Issues](https://github.com/Wigtertainment-Ltd/key-lint/issues).
For code contributions, read [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). Report security issues privately as described
in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Wigtertainment Ltd
