# Changelog

## Unreleased — CONTRI for AI coding agents

**New**

- **`contri-mcp`**, an MCP server that gives AI coding agents (Claude Code, Cursor, Claude Desktop and others) CONTRI's checks before they start work: `check_issue`, `repo_health`, `team_responsiveness`, `find_issues`, `discover_projects` and `contribution_brief`, plus the `find_first_issue` and `can_i_take_this` prompts. It reuses the extension's reports and verdicts, runs locally over stdio, and is read-only. **Sign in with GitHub** works there too: the agent shows a code you approve on github.com, with no token to copy. A rejected or placeholder token falls back to anonymous instead of breaking every tool. See [mcp/README.md](mcp/README.md).

## 0.3.3 — more accurate claims and times

**Fixed**

- Refusals are no longer read as claims: “I can't take this one, sorry”, “I will not take this” or “I'm unable to work on this” no longer show the issue as claimed, and “I won't be able to fix this” counts as giving it back. Claims typed with curly apostrophes (phones, macOS) are now recognized. (#11, #14)
- GitHub pages such as Copilot, advisories, stars lists and sessions are no longer mistaken for repositories, which saves requests that could never succeed. (#12, #15)
- Durations round before choosing the unit, so reply and merge times show “1h” instead of “60m” and “2d” instead of “48h”. (#13, #16)

Thanks to @faizulr for reporting and fixing all three.

## 0.3.2 — Sign in with GitHub

**New**

- **Sign in with GitHub** works out of the box: the CONTRI OAuth App (device flow, no scopes, read-only public access, tokens that don't expire) is built into every release. You get a short code, approve it on github.com, and CONTRI switches to 5,000 requests an hour. The personal access token option is still there.

**Changed**

- Forks can use their own OAuth App with `VITE_GITHUB_CLIENT_ID`, or `none` for token-only builds.
- The release package check fails if the OAuth client ID is missing.

## 0.3.1 — release hardening

**Fixed**

- Anonymous issue checks read the newest comments on threads with more than 300 comments, so a recent claim is no longer missed (it could show “Looks free” for an issue someone had just taken). Signed-in checks read the latest 50 timeline references instead of the first 50.
- Missing data is never shown as inactivity: if merge activity can't be loaded, the Overview and the repository badge say so instead of “No human merges in the last four weeks”.
- “Looks free” says when only part of a long discussion was checked for claims, and the comment count shows how many were really inspected. If no comment could be loaded, the verdict is “Partly checked”, not green.
- Sign in with GitHub stops with a clear message when GitHub reports an error polling cannot fix (for example device flow disabled), instead of waiting until the code expires.
- A sign-in GitHub rejects (expired or revoked) is flagged, and Settings asks you to reconnect instead of showing “Signed in”.
- Empty repositories are explained instead of “GitHub returned 409. Try again later”.
- Hovering a cream button or the current tab no longer turns it into dark text on dark glass.
- Arrows and stars are drawn as SVG icons in the extension and on the website, so they look the same on every device (phones used to show different glyphs or emoji).

**Security and privacy**

- “Stay signed in” stores the token encrypted at rest (AES-GCM, non-extractable key), so it is no longer in plain text, and only one copy is kept. 0.3.0 tokens are migrated automatically; a temporary storage error never deletes the sign-in or locks the extension.
- Links built from API data must be `https:`; anything else is shown as text.
- PRIVACY.md gains the Chrome Web Store Limited Use statement, a data-handled table and a changes section.
- The release package check also rejects missing referenced files, remote code, source maps and credential-like strings. CI audits shipped dependencies.

**Accessibility**

- All measured text meets WCAG AA contrast in light and dark mode; same teal glass, slightly more opaque.
- Escape minimizes the panel and returns focus to the launcher (in a text field it first leaves the field, keeping what you typed); the panel is a labelled region.
- Failed requests offer “Try again”, and focus stays in the panel.
- axe-core (WCAG 2.2 A/AA) runs on the installed extension in CI, plus a contrast audit over the glass.

**Performance**

- The badge re-check no longer runs on GitHub pages without a repository or in hidden tabs. Measured on the GitHub dashboard over 20 s idle: script time 1.12 ms → 0 ms, task time 4.05 ms → 2.15 ms (no extension: 1.9 ms).

**Docs and launch**

- Chrome Web Store kit with copy-ready listing, permission and data declarations, reviewer steps and store graphics; known limitations and troubleshooting in the README; launch drafts and real first issues.

## 0.3.0 — contributor co-pilot

**New**

- Badges inside GitHub: next to issue titles (“Looks free”, “Claimed by `@user`”, “Claim went quiet”, “Open PR #n”, “Assigned”) and in the repository About box.
- Claim detection: finds “I'd like to work on this” comments, respects people who give an issue back, and flags claims with no activity for 21+ days.
- Linked pull requests now include GitHub's Development panel and closing keywords (signed in).
- On-device AI with Chrome's built-in Gemini Nano: thread summary and “How do I start?”. Nothing is uploaded.
- Discover: projects matched to the languages you use, ranked by recent human merges and good-first-issues.
- Watched issues with hourly checks and notifications.
- Sign in with GitHub (OAuth device flow, no backend, no scopes).
- Dark variant of the CONTRI glass theme that follows GitHub's appearance.
- Welcome page on install; preferences for launcher behavior and badges.
- Experimental Firefox package.

**Better evidence**

- Maintainers are identified from triage and merge activity, CODEOWNERS and the repository owner, not only GitHub's team badge (which hides private organization members).
- Exact merged-PR count for 90 days from GitHub search, excluding common bots.
- One GraphQL query per report when signed in (team analysis: ~80 requests → 2–3).
- Partial reports are cached for a shorter time instead of never.

**Lighter and calmer**

- Starts as a small launcher instead of opening on every repository.
- `widget.js` 366 KB → ~85 KB: Preact runtime, inline icons, fonts loaded from the package instead of inlined (they never rendered inside the shadow root).
- Navigation detection uses Turbo and Navigation API events instead of watching the whole page.
- Requests run two at a time; back-off survives worker restarts.

**Brand**

- The contri. symbol (arrow in a circle) and wordmark across the toolbar icon, launcher, widget, badges and settings; website link in the extension details and Settings.

**Project**

- Code split into `core`, `background`, `content`, `settings` with ESLint and Prettier.
- 65 unit tests and 8 installed-extension end-to-end tests in Chromium against a mock GitHub, run in CI.
- CI, CodeQL, Dependabot and a tag-driven release workflow; README link checking.
- Up to date: Preact 11, ESLint 10 (React hooks rules v7), Playwright 1.64, TypeScript types and GitHub Actions v7.

## 0.2.0 — release candidate

- Rebrand to CONTRI; compact movable glass widget; session-default GitHub connection; team-response evidence; referenced-PR checks; contribution briefs; local shortlist; launch website.
