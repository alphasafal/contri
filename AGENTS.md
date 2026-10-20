# AGENTS.md

Instructions for AI coding agents (Copilot, Cursor, Codex, Devin, Claude and others) working on CONTRI, and for the people who use them. Humans: [CONTRIBUTING.md](CONTRIBUTING.md) has the same rules in more detail.

AI-assisted contributions are welcome. The person who opens the issue or pull request is responsible for it: they must have checked the problem themselves, reviewed every line, and be able to answer review questions without the tool.

## Project in one paragraph

CONTRI is a Manifest V3 Chrome extension (Preact + TypeScript + Vite) that shows, on GitHub pages, whether an issue is free to take, how quickly maintainers reply and whether a project is active. It has no backend and no analytics: the service worker calls the public GitHub API directly, anonymously (60 requests an hour) or with an optional read-only sign-in. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/METRICS.md](docs/METRICS.md). A generated walkthrough is at [DeepWiki](https://deepwiki.com/alphasafal/contri); it can lag behind the code, so always confirm against the source.

## Setup and commands

Use Node.js 24 (`.nvmrc`).

```sh
npm ci
npm run check        # Prettier, ESLint, docs links, unit tests (Vitest), build. Must pass.
npm run test:e2e     # Playwright tests against the installed extension and a mock GitHub
npm run build        # then load dist/ with "Load unpacked" in chrome://extensions
npm run build:mcp    # the MCP server for AI agents → mcp/dist/contri-mcp.js
```

Run the commands yourself and report the real output. Never write "tests pass" in a pull request unless you ran them and they passed.

## Where things live

| Path                      | What it holds                                                                    |
| ------------------------- | -------------------------------------------------------------------------------- |
| `src/core/`               | Pure logic: claims, verdicts, metrics, team roster. No network, no `chrome.*`.   |
| `src/background/reports/` | Fetch and normalize GitHub data. Each report has a REST and a GraphQL path.      |
| `src/background/`         | Service worker: auth (encrypted token vault), transport, cache, watched issues.  |
| `src/content/`            | The widget and badges injected into GitHub pages (shadow DOM), `widget.css`.     |
| `src/settings/`           | Settings and welcome page.                                                       |
| `src/shared/`             | Formatting, URL parsing, message protocol, config.                               |
| `tests/unit/`             | Vitest unit tests (`claims`, `core`, `reports`, `worker`).                       |
| `tests/e2e/`              | Playwright tests with a mock GitHub (`mock-github.ts`), accessibility, contrast. |
| `mcp/`                    | MCP server for AI agents: wraps the reports; own cache and transport, tests.     |
| `website/dist/`           | The static website, deployed from `main`.                                        |

## Rules for changes

- **One issue per pull request.** Link it with `Fixes #123`. Keep the diff small and focused; don't reformat or refactor unrelated code.
- **Bug fixes need a test that fails on `main` and passes with the fix.** Put pure logic tests in `tests/unit/`. If an existing test already covers the case, say which one in the pull request instead of adding a duplicate.
- **Keep calculations pure** in `src/core/`; reports only fetch and normalize.
- **Change both paths.** If you touch a report, update the REST (anonymous) and GraphQL (signed-in) functions and their tests in `tests/unit/reports.test.ts`.
- **Never show missing data as zero.** Use `null` and say what is unknown.
- **Respect the request budget.** Anonymous users have 60 requests an hour. State the request cost of anything new.
- **Privacy and security:** no new hosts, no remote code, no analytics, no new extension permissions, and no changes to `.github/workflows/` unless a maintainer asked for them in the issue. Never commit tokens, keys or personal data.
- **Keep the CONTRI glass look** in light and dark mode, with keyboard access, visible focus and readable contrast.
- **Commit messages** follow the existing style: `fix: …`, `feat: …`, `docs: …`, `test: …`, optionally with a scope like `fix(insight): …`.

## Issues

Only open an issue for a problem you have reproduced. Include exact steps and evidence (screenshot, console output, failing test, or the exact input and wrong output), and answer the AI question in the template honestly. Don't file speculative or duplicate issues, and don't open many issues or pull requests at once from automated scans.

## Pull requests

Fill in every section of the template, including **Evidence**, **Tests** and **AI assistance**. Name the tool and what it did (found the bug, wrote the code, wrote the tests, wrote the description). A maintainer reviews every pull request by hand; unexplained or unverified AI output will be closed.
