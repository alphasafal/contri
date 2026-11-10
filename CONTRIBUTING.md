# Contributing to CONTRI

Thanks for helping make open source easier to join. Small, focused pull requests are the easiest to review.

## Before you start

- Look for an existing issue, or open one describing the contributor problem and how to reproduce it.
- Bug reports need **exact steps and evidence**: a screenshot, console output, a failing test, or the exact input and wrong output. A maintainer has to be able to see the bug for themselves.
- Comment that you'd like to work on it. (CONTRI itself will show maintainers and other contributors that you claimed it.)

## Understand the code

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/METRICS.md](docs/METRICS.md) explain how CONTRI is built and how every number is calculated.
- [DeepWiki](https://deepwiki.com/alphasafal/contri) is a browsable, searchable walkthrough of the whole codebase where you can ask questions, for example [how metrics and the maintainer roster work](https://deepwiki.com/alphasafal/contri/3.2-metrics-and-maintainer-roster). It is generated from the repository and can lag behind recent changes; the code and `docs/` are the source of truth.

## Set up

1. Fork and clone the repository. Use Node.js 22.12 or newer; CI and releases use 24 (`.nvmrc`).
2. `npm ci`
3. `npm run build`, then load `dist` with **Load unpacked** in `chrome://extensions`.
4. “Sign in with GitHub” works out of the box with the CONTRI OAuth App; see the README to use your own.

## Before opening a pull request

```sh
npm run check        # Prettier, ESLint, unit tests, build
npm run test:e2e     # installed-extension tests (needs `npx playwright install chromium` once)
```

Then try the flow you changed in a real Chrome profile on a real repository.

## Guidelines

- **Keep calculations pure.** Put logic in `src/core/` with unit tests; reports in `src/background/reports/` only fetch and normalize.
- **Support both paths.** If you change a report, update both the REST (anonymous) and GraphQL (signed-in) functions and their tests in `tests/unit/reports.test.ts`.
- **Never show unavailable evidence as zero.** Use `null` and a warning.
- **Respect the request budget.** Anonymous users have 60 requests per hour. Note the cost of new requests in your PR.
- **Keep the CONTRI glass look.** Reuse the existing classes and colors in `src/content/widget.css`; both light and dark variants should look like the same product.
- **Accessibility:** keyboard access, visible focus, readable contrast, reduced motion.
- **Privacy:** no analytics, no new hosts, no remote code. Never commit tokens or personal data, and never put a token in screenshots or logs.

## Tests for bug fixes

Every bug fix needs a test that **fails on `main` and passes with your change**, so the bug can't come back unnoticed. Pure logic goes in `tests/unit/`; installed-extension behaviour in `tests/e2e/`. If an existing test already covers the case, you don't need a new one: name that test in your pull request and explain why it was missing the case before.

## Pull request description

Link the issue (`Fixes #123`), say what changed and why, and show **evidence**: before and after (test output, input → output, or screenshots for UI changes). List what you verified (commands, browsers, repositories) and any limitations. The template will prompt you.

## Using AI tools

AI-assisted contributions are welcome, with three conditions:

1. **Say so.** The issue and pull request templates ask whether you used an AI tool, which one, and what it did.
2. **Verify it yourself.** Reproduce the bug, run the commands, and review every changed line. You should be able to explain the change without the tool.
3. **Point your agent at [AGENTS.md](AGENTS.md).** It holds the project rules and commands in a form coding agents read automatically.

Pull requests with unverified or unexplained AI output will be closed, however good they look.
