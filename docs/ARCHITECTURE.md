# Architecture

CONTRI is a Manifest V3 extension with three parts that talk over a single, validated message port.

```
github.com tab                         extension
┌──────────────────────────┐   port    ┌──────────────────────────────────────┐
│ content script (widget.js)│ ───────▶ │ service worker (background.js)        │
│  • launcher + widget (UI) │  {op,…}  │  • validation.ts  allow-list of ops   │
│  • issue / repo badges    │ ◀─────── │  • cache.ts       TTL cache            │
│  • on-device AI (ai.ts)   │  report  │  • reports/*      REST or GraphQL      │
└──────────────────────────┘           │  • transport.ts   token, queue, limits │
                                       │  • auth.ts        device flow / token  │
                                       │  • vault.ts       AES-GCM at rest      │
settings.html ── trusted port ───────▶ │  • watch.ts       hourly alarms        │
                                       └───────────────────▲──────────────────┘
                                                           │ HTTPS
                                                     api.github.com
```

## Principles

- **Pages are untrusted.** The content script runs on github.com, so every message is validated (`background/validation.ts`). Credential operations (`connect`, `deviceStart`, …) are only accepted from the extension's own Settings page.
- **The token never reaches a page.** Extension storage is restricted to trusted contexts; content scripts only receive reports. The token is kept in one place: `chrome.storage.session` (memory) by default, or `chrome.storage.local` sealed with AES-GCM when remembered (`background/vault.ts`; the key is a non-extractable Web Crypto key in the extension's IndexedDB). A 401 marks it invalid so Settings can ask the user to reconnect.
- **Links are https only.** Every link rendered from API data goes through `safeHref()` (`shared/repo.ts`); Preact does not block `javascript:` URLs on its own.
- **No idle work off repository pages.** The badge re-check timer runs only on repository pages with badges enabled, and skips hidden tabs.
- **One request is better than thirty.** When signed in, reports use one GraphQL query (`preferGraphql` in `reports/context.ts`) and fall back to REST with a visible note if GraphQL fails.
- **Same numbers either way.** REST and GraphQL responses are normalized into the same shapes (`Reply`, `Thread`, `Merge`) before any calculation, and all calculations live in `src/core/` as pure functions.
- **Honest coverage.** Reports carry `warnings`; unavailable data is `null`, never `0`.

## Folders

| Path                      | Responsibility                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `src/core/metrics.ts`     | activity, timing, first team reply, link state, discovery score                               |
| `src/core/team.ts`        | maintainer roster from associations, triage events, merges, CODEOWNERS and owner              |
| `src/core/claims.ts`      | “I'd like to work on this” detection, released and stale claims                               |
| `src/core/verdict.ts`     | one headline for “can I work on this?”                                                        |
| `src/background/reports/` | `overview`, `team`, `insight` (one issue), `issues` (search), `discover`, `documents`, `repo` |
| `src/content/index.tsx`   | boots once per tab, tracks SPA navigation, positions the widget                               |
| `src/content/badges.ts`   | badges inside GitHub's DOM (re-attached when GitHub re-renders)                               |
| `src/content/ui/`         | widget tabs and shared components                                                             |

## MCP server (`mcp/`)

`contri-mcp` exposes the same reports to AI coding agents over the Model Context Protocol (stdio). It is a thin Node wrapper, not a second implementation:

```
MCP client (Claude Code, Cursor…) ── stdio ──▶ mcp/src/server.ts   tools, prompts, input schemas
                                               mcp/src/tools.ts    calls src/background/reports/* and src/core/verdict, brief
                                               mcp/src/cache.ts    in-memory TTL cache (same TTLs as core/cache-policy.ts)
                                               mcp/src/auth.ts     GITHUB_TOKEN, saved sign-in, or device-flow sign_in
                                               mcp/src/transport.ts token, 2 requests in flight, back-off ── HTTPS ──▶ api.github.com
```

The reports only depend on `GitHubClient` and its swappable transport (`setTransport`), so the server plugs in its own transport and cache and leaves `chrome.*` code alone. The token comes from `GITHUB_TOKEN`, or from the `sign_in` tool, which runs the same device flow and OAuth App as the extension and saves the sign-in in `~/.config/contri/mcp-credentials.json` (mode 600). A token GitHub rejects is dropped and the request retried anonymously, so the agent can offer sign-in instead of every tool failing. Apart from `sign_in`/`sign_out`, every tool is read-only. `npm run build:mcp` bundles everything except the MCP SDK and zod into `mcp/dist/contri-mcp.js`. Tests live in `mcp/tests/` and run with `npm test`.

## Why Preact?

The content script runs on every GitHub page, so its size matters. The UI is written with React APIs and bundled with Preact's compatible runtime (see `vite.content.config.ts`), keeping `widget.js` around 85 KB.

## Fonts in a shadow root

Chrome ignores `@font-face` inside shadow roots. `content/fonts.ts` declares the fonts once on the page, loading them from the extension package via `web_accessible_resources` with dynamic URLs.

## When GitHub changes its layout

Badges look for these anchors, in order, and silently skip if none exist:

- issue title: `[data-testid="issue-title"]`, `.gh-header-title`, `.js-issue-title`
- About box: an `h2` reading “About” inside `.Layout-sidebar`, `[data-testid="repository-sidebar"]` or `aside`

If a badge stops appearing, update `issueAnchor()` / `repoAnchor()` in `badges.ts` and the mock pages in `tests/e2e/mock-github.ts`.
