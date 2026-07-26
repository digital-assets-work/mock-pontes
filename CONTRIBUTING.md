# Contributing to mock-pontes

Thanks for your interest in improving mock-pontes! This project provides a local
mock of the ECB Pontes (TARGET) A2A API so bank and PSP developers can build and
test their integrations without the ECB test environment.

## Ground rules

- **Scope:** the mock should track the *publicly documented* Pontes A2A API. When
  adding or changing behaviour, reference the relevant part of the official ECB
  documentation:
  <https://www.ecb.europa.eu/paym/target/target-professional-use-documents-links/pontes-documents-links/html/index.en.html>
- **No confidential material.** Do not add any non-public specifications,
  credentials, real certificates, or internal deployment details.
- Be respectful and constructive. By participating you agree to uphold a
  welcoming, harassment-free environment.

## Development setup

Requires Node.js 22+.

```bash
npm ci
cp .env.example .env
npm run dev       # hot-reload dev server
npm test          # run the test suite
npm run build     # production bundle
```

## Making changes

1. Fork the repo and create a feature branch.
2. Keep changes focused and covered by tests where practical.
3. Ensure `npm test` and `npm run build` pass before opening a PR.
4. Use clear, conventional commit messages (e.g. `feat: ...`, `fix: ...`,
   `docs: ...`, `test: ...`).
5. Open a pull request describing the change and linking any relevant ECB
   documentation.

## Reporting bugs & requesting features

Use the GitHub issue templates. Please include reproduction steps, the version /
image tag, and expected vs. actual behaviour.

## Security

Do not open public issues for security vulnerabilities. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the
[Apache-2.0 License](LICENSE).
