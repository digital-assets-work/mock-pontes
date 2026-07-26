# Security Policy

## Scope & intended use

mock-pontes is a **development and testing tool**. It ships with a self-signed
runtime PKI and permissive defaults so it is easy to run locally. **Do not deploy
it as a production service or expose it on the public internet without placing it
behind appropriate access controls.** It must never be used to process real funds,
real credentials, or production traffic.

## Reporting a vulnerability

If you discover a security vulnerability, please **do not open a public issue**.

Instead, report it privately via GitHub's
[private vulnerability reporting](https://github.com/digital-assets-work/mock-pontes/security/advisories/new)
for this repository.

Please include:

- a description of the vulnerability and its impact,
- steps to reproduce (proof of concept if possible),
- the affected version / image tag.

We will acknowledge your report and work with you on a fix and coordinated
disclosure.

## Supported versions

Security fixes target the latest released version and `main`.
