# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | Yes |
| < 1.0 | No |

This covers the `key-lint` desktop app, `@key-lint/core`, `@key-lint/cli` and the
GitHub Action in `packages/action`.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report vulnerabilities privately via
[GitHub Security Advisories](https://github.com/Wigtertainment-Ltd/key-lint/security/advisories/new)
or by email to <security@wigtertainment.ltd>.

Include if possible:

- affected component and version
- steps to reproduce or a proof of concept
- the impact you expect

We aim to acknowledge a report within 5 business days and to provide a remediation
plan within 30 days. Please give us a reasonable window to ship a fix before any
public disclosure. We are happy to credit reporters in the advisory.

## Scope notes

KeyLint reads source files and translation files from a directory you point it at, and
writes report files. It does not transmit project contents anywhere. Reports may
contain translation keys and file paths from the scanned project – treat generated
artifacts (`keylint-report/`, job summaries) accordingly when publishing CI logs.
