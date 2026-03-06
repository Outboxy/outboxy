# Security Policy

This document describes which package versions receive security fixes and how to report a vulnerability responsibly.

## Supported Versions

Only the latest published version of each package receives security fixes.

| Package                     | Version | Supported |
| --------------------------- | ------- | :-------: |
| `@outboxy/sdk`              | 0.1.x   |    Yes    |
| `@outboxy/sdk-nestjs`       | 0.1.x   |    Yes    |
| `@outboxy/dialect-core`     | 0.1.x   |    Yes    |
| `@outboxy/dialect-postgres` | 0.1.x   |    Yes    |
| `@outboxy/dialect-mysql`    | 0.1.x   |    Yes    |
| `@outboxy/publisher-core`   | 0.1.x   |    Yes    |
| `@outboxy/tracing`          | 0.1.x   |    Yes    |
| `@outboxy/schema`           | 0.1.x   |    Yes    |
| `@outboxy/server` (Docker)  | 0.1.x   |    Yes    |

## Reporting a Vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/Outboxy/outboxy/security/advisories/new) to submit a security advisory directly. This keeps the report confidential and allows us to coordinate a fix before public disclosure.

Include the following in your report:

- A description of the vulnerability and its potential impact.
- Steps to reproduce, or a proof of concept.
- The affected package(s) and version(s).

We will acknowledge receipt within 48 hours and aim to deliver a fix or mitigation plan within 7 days for critical issues.

## Disclosure Policy

We follow coordinated disclosure. Please allow reasonable time to address the issue before making details public. Once a fix is released, we will publish a GitHub security advisory and credit the reporter, unless anonymity is requested.
