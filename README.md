<div align="center">

<a href="https://contri-two.vercel.app">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/alphasafal/contri/main/docs/assets/contri-logo-white.png" />
    <img src="https://raw.githubusercontent.com/alphasafal/contri/main/docs/assets/contri-logo-dark.png" width="360" alt="contri." />
  </picture>
</a>

### Open Source Compass

**Find open-source issues you can actually take.**

Project activity, maintainer reply times, claims and linked pull requests — right on GitHub.

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Add%20to%20Chrome-476263?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/njglkdpnkbieohopledjohcpkafogbid)
[![CI](https://github.com/alphasafal/contri/actions/workflows/ci.yml/badge.svg)](https://github.com/alphasafal/contri/actions/workflows/ci.yml)
[![CodeQL](https://github.com/alphasafal/contri/actions/workflows/codeql.yml/badge.svg)](https://github.com/alphasafal/contri/actions/workflows/codeql.yml)
[![Release](https://img.shields.io/github/v/release/alphasafal/contri?include_prereleases&sort=semver&color=476263)](https://github.com/alphasafal/contri/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-476263.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-476263?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-3e5143.svg)](CONTRIBUTING.md)
[![Good first issues](https://img.shields.io/github/issues/alphasafal/contri/good%20first%20issue?label=good%20first%20issues&color=3e5143)](https://github.com/alphasafal/contri/issues?q=is%3Aopen+label%3A%22good+first+issue%22)
[![Ask DeepWiki](https://img.shields.io/badge/DeepWiki-Ask%20about%20the%20code-476263)](https://deepwiki.com/alphasafal/contri)
[![Stars](https://img.shields.io/github/stars/alphasafal/contri?style=social)](https://github.com/alphasafal/contri/stargazers)

**🌐 [contri-two.vercel.app](https://contri-two.vercel.app)** · [Install](#install) · [Features](#what-it-does) · [For AI agents (MCP)](#for-ai-coding-agents-mcp) · [How the numbers work](docs/METRICS.md) · [Code walkthrough](https://deepwiki.com/alphasafal/contri) · [Contributing](CONTRIBUTING.md) · [Launch kit](docs/LAUNCH.md)

<img src="docs/assets/screenshot-issue.webp" width="880" alt="contri. on a GitHub issue: a “Claim went quiet” badge under the title and the details panel" />

</div>

<table>
  <tr>
    <td width="50%"><img src="docs/assets/screenshot-overview.webp" alt="Overview: exact merged PRs, human authors, commits and a 90-day chart" /><p align="center"><b>Is it alive?</b></p></td>
    <td width="50%"><img src="docs/assets/screenshot-team.webp" alt="Team: first reply times for outside contributors and the maintainer roster" /><p align="center"><b>Will someone reply?</b></p></td>
  </tr>
</table>

## Why CONTRI?

Starting in open source is mostly guesswork: is the project still maintained, will anyone review my PR, and is someone already working on that “good first issue”? CONTRI answers those three questions on the page you're already on, using public evidence it links to — no backend, no analytics, public repositories only.

## What it does

<p align="center"><img src="docs/assets/issue-badge.webp" width="640" alt="The contri. badge under a GitHub issue title" /></p>

| Where              | What you see                                                                                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issue page         | A badge beside the title: **Looks free**, **Claimed by @sam**, **Claim went quiet**, **Open PR #12** or **Assigned**. Click for the evidence.                                                         |
| Repository page    | A badge in the About box with merges in the last 90 days and the team's typical reply time.                                                                                                           |
| Overview           | Exact PRs merged in 90 days (common bots excluded), human authors, commits, weekly chart, median time to merge, latest release.                                                                       |
| Team               | Median and average first team reply for outside PRs and issues, who is still waiting, and the maintainer roster — found from GitHub team badges, who labels/assigns/merges, CODEOWNERS and the owner. |
| Issues             | Beginner presets, “Looks free” filter, claim detection, linked-PR checks (a whole page at once when signed in).                                                                                       |
| On-device AI       | “Summarize the thread” and “How do I start?” using Chrome's built-in Gemini Nano. Runs locally; nothing is uploaded.                                                                                  |
| Discover           | Projects matched to the languages you use, ranked by recent human merges and open good-first-issues.                                                                                                  |
| Saved & watched    | A private shortlist with notes, side-by-side comparison, and **watched issues** that notify you when an issue is unassigned, gets a PR, goes quiet or closes.                                         |
| Contribution brief | A source-linked prompt to paste into any AI chat when on-device AI is unavailable.                                                                                                                    |
| AI coding agents   | The same checks as an MCP server, so Claude Code, Cursor and other agents ask “is this issue free?” before they start work. See [below](#for-ai-coding-agents-mcp).                                   |

CONTRI follows GitHub's light or dark appearance with the same teal glass look.

<p align="center"><img src="docs/assets/screenshot-dark.webp" width="720" alt="contri. in GitHub dark mode" /></p>

## Install

### From the Chrome Web Store (recommended)

**[Add CONTRI to Chrome](https://chromewebstore.google.com/detail/njglkdpnkbieohopledjohcpkafogbid)** — one click, updates automatically. The same listing works in Edge (allow extensions from other stores when asked) and Brave.

### From a release

For Firefox (experimental) or a manual install:

1. Download `contri-v<version>.zip` (not “Source code”) from the [latest release](https://github.com/alphasafal/contri/releases) and unzip it.
2. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and choose the unzipped folder.
4. A welcome page opens. Sign in with GitHub (or skip and use anonymous mode).

### From source

Requires Node.js 24.

```sh
npm ci
npm run build        # outputs dist/
```

Then **Load unpacked** → `dist`. After pulling changes, rebuild, click **Reload** on the extension card and reload your GitHub tab.

**Firefox (experimental):** `npm run package:firefox` creates `contri-v<version>-firefox.zip` for `about:debugging` → _Load Temporary Add-on_. On-device AI is Chrome-only.

## For AI coding agents (MCP)

AI agents increasingly open pull requests on issues someone already claimed. [`contri-mcp`](mcp/README.md) gives them CONTRI's checks as an [MCP](https://modelcontextprotocol.io) server, with the same reports and verdicts as the extension: `check_issue`, `repo_health`, `team_responsiveness`, `find_issues`, `discover_projects` and `contribution_brief`. It runs locally over stdio, is read-only, and talks only to `api.github.com`.

```sh
git clone https://github.com/alphasafal/contri ~/contri
cd ~/contri && npm ci && npm run build:mcp
claude mcp add --transport stdio contri -- node ~/contri/mcp/dist/contri-mcp.js
```

No token to paste: when CONTRI isn't signed in, the agent offers **Sign in with GitHub**, shows a short code, and you approve it on github.com, the same device flow as the extension. Setup for Cursor, Claude Desktop and other clients is in [mcp/README.md](mcp/README.md).

## Signing in

Anonymous mode works within GitHub's limit of **60 requests per hour**. Signing in raises it to **5,000** and switches CONTRI to GitHub's GraphQL API, so most checks take one request instead of dozens.

- **Sign in with GitHub** uses the OAuth device flow with the CONTRI OAuth App: you get a short code, approve it on github.com, done. No password ever passes through CONTRI, and no scopes are requested (public, read-only access).
- **Personal access token**: Settings walks you through creating a fine-grained, read-only token for public repositories.

The sign-in is kept in memory until the browser closes unless you choose “Stay signed in”, which stores it encrypted (AES-GCM). Either way it lives where GitHub pages cannot read it and is only ever sent to `api.github.com`. If GitHub rejects it (expired or revoked), Settings asks you to reconnect.

### “Sign in with GitHub” in your own build

Every build uses the CONTRI OAuth App (client ID in `src/shared/config.ts`; client IDs are public and the device flow has no secret). A fork that wants its own app:

1. On GitHub: **Settings → Developer settings → OAuth Apps → New OAuth App**. Use your homepage as the callback URL (it is not used), tick **Enable Device Flow**, and leave **Expire user access tokens** off.
2. Copy the **Client ID** and build with `VITE_GITHUB_CLIENT_ID=<your client id> npm run build` (or put it in `.env`).

`VITE_GITHUB_CLIENT_ID=none` builds a version that offers only the token option.

## Request budget

| Action                  | Anonymous       | Signed in |
| ----------------------- | --------------- | --------- |
| Overview                | ~7 requests     | 2         |
| Team analysis           | ~25 requests    | 2–3       |
| Issue check             | ~3 requests     | 1         |
| Page of 30 issues + PRs | 2 + 3 per issue | 2         |

Reports are cached (team: 6 hours, overview: 30 minutes, issue checks: 10 minutes). Partial reports are cached for a third of that so large repositories don't burn requests on every visit.

## Development

```sh
npm run dev          # layout preview of the widget (no live data)
npm test             # unit tests (fixtures, no network)
npm run test:e2e     # installs dist/ into Chromium, drives it on a mock GitHub, runs axe accessibility checks
npm run lint         # ESLint
npm run format       # Prettier
npm run check        # format check + lint + unit tests + build
npm run package      # dist → contri-v<version>.zip (+ sha256)
npm run verify:package
CONTRI_CONTRAST=1 npx playwright test contrast   # WCAG AA text contrast over the glass
CONTRI_PERF=1 npx playwright test perf           # content-script cost on GitHub pages
```

For `test:e2e`, run `npm run build` first and install the browser once with `npx playwright install chromium`.

The code is organized so contributors can work on one layer at a time:

```
src/core/        pure logic: metrics, maintainer roster, claim detection, verdicts (unit-tested)
src/background/  service worker: sign-in, request queue, caching, GitHub REST + GraphQL reports
src/content/     what runs on github.com: launcher, widget UI, badges, on-device AI
src/settings/    the Settings / welcome page
src/shared/      types and helpers shared by both sides
mcp/             the MCP server for AI agents: reuses src/core and the reports
tests/unit/      Vitest
tests/e2e/       Playwright + mock GitHub
```

More detail in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

**New to the codebase?** [DeepWiki](https://deepwiki.com/alphasafal/contri) has a browsable walkthrough of every part of CONTRI — the service worker, claim detection and verdicts, [metrics and the maintainer roster](https://deepwiki.com/alphasafal/contri/3.2-metrics-and-maintainer-roster), the widget, tests and release pipeline — and you can ask it questions about the code. It is generated automatically from this repository, so if it disagrees with the code or `docs/`, the code and `docs/` win.

## Honest numbers

Every number links to its evidence. Unavailable data is shown as “—”, never as zero. Samples say how much they cover, and ≥ marks a lower bound. A missing linked PR does not prove nobody is working on an issue, and CONTRI says so. Full definitions: [docs/METRICS.md](docs/METRICS.md).

## Known limitations

- **Public evidence only.** CONTRI sees what GitHub's public API shows. Work nobody linked or mentioned is invisible, so “Looks free” is a strong hint, not a guarantee.
- **Samples on big projects.** Charts, author counts and team reply times use the most recent items (up to 100 merged PRs, 20 PRs and issues per kind, the latest 100–300 comments of an issue). Every sampled number says so, and lower bounds are marked ≥.
- **Claim detection is a heuristic** over English phrases such as “I'd like to work on this”, `/assign` or “assign me”. Other languages and unusual wording may be missed.
- **Maintainer detection** uses GitHub's team badges, triage and merge activity, CODEOWNERS and the owner. Maintainers who never triage or merge in the sampled window may be missed.
- **GitHub layout changes** can move or hide the inline badges until CONTRI is updated. The panel keeps working.
- **On-device AI** needs a Chrome build with the built-in model; elsewhere CONTRI offers the copy-paste brief.
- **Anonymous mode** shares GitHub's limit of 60 requests per hour with anything else on your network.

## Troubleshooting

| Symptom                                           | What to do                                                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| No launcher or badge after installing or updating | Reload the GitHub tab. Tabs opened before an install or update don't have the new content script yet.                           |
| “GitHub request limit reached”                    | Wait until the time shown, or sign in (5,000 requests per hour).                                                                |
| “Your GitHub sign-in expired or was revoked”      | Settings → Sign out, then sign in again or paste a new token.                                                                   |
| “Not found on GitHub”                             | The repository is private, renamed or deleted. CONTRI only reads public repositories.                                           |
| A badge is missing on an issue page               | GitHub may have changed its layout. The panel still works; please [open an issue](https://github.com/alphasafal/contri/issues). |
| Numbers look stale                                | Use ↻ in the panel to refresh, or Settings → Clear cached reports.                                                              |
| “Sign in with GitHub” is missing                  | The build was made with `VITE_GITHUB_CLIENT_ID=none`. Use a token, or the official release.                                     |

## Contributing

Issues and pull requests are welcome — especially for accessibility, metric accuracy, GitHub layout changes that break badges, and translations. Start with [CONTRIBUTING.md](CONTRIBUTING.md). Good first issues are labeled `good first issue` (CONTRI will tell you whether they're free).

## FAQ

<details>
<summary><b>Does CONTRI send my data anywhere?</b></summary>

Only to GitHub's API, to read public repository data. There is no CONTRI server and no analytics. On-device AI runs inside Chrome. See [PRIVACY.md](PRIVACY.md).
</details>

<details>
<summary><b>Does “Looks free” guarantee nobody is working on an issue?</b></summary>

No. It means CONTRI found no assignee, no recent claim and no linked open pull request. Someone may be working without saying so — always comment before you start.
</details>

<details>
<summary><b>Why does the team tab say “not enough evidence”?</b></summary>

Timings need at least three answered items in the sample. Small or quiet projects often don't have that many recent outside contributions, and CONTRI won't guess.
</details>

<details>
<summary><b>Does it work on private repositories?</b></summary>

No, by design. CONTRI is for joining public open-source projects.
</details>

<details>
<summary><b>Which browsers are supported?</b></summary>

Chrome, Edge, Brave and other Chromium browsers (version 124+). Firefox 128+ is experimental. On-device AI needs a Chrome build with built-in AI.
</details>

## Roadmap

- [x] Issue availability badges with claim detection
- [x] Maintainer roster beyond GitHub's team badge
- [x] Sign in with GitHub (device flow) and GraphQL reports
- [x] On-device AI summaries
- [x] Watched issues with notifications
- [x] [Chrome Web Store listing](https://chromewebstore.google.com/detail/njglkdpnkbieohopledjohcpkafogbid)
- [x] MCP server, so AI coding agents check an issue is free before they start
- [ ] Badges on GitHub's issue list and search results
- [ ] Translations
- [ ] Maintainer view: who is waiting longest for a reply

Have an idea? [Open a feature request](https://github.com/alphasafal/contri/issues/new?template=feature_request.yml).

## Contributors

<a href="https://github.com/alphasafal/contri/graphs/contributors"><img src="https://contrib.rocks/image?repo=alphasafal/contri" alt="Contributors" /></a>

If CONTRI helped you find your first contribution, a ⭐ helps other newcomers find it too.

[![Star history](https://api.star-history.com/svg?repos=alphasafal/contri&type=Date)](https://star-history.com/#alphasafal/contri&Date)

## License

Built and maintained by [Safal Gupta (@alphasafal)](https://github.com/alphasafal).

MIT © Safal Gupta. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
