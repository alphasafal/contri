# Changelog

## Unreleased

**New**

- **CONTRI as a Claude plugin** (`plugin/`). `/plugin install contri --marketplace alphasafal/contri` in Claude Code adds the `contri-mcp` server and two skills: `/contri:can-i-take-this` checks one issue and says whether to start, ask in the thread first or pick another, and `/contri:find-first-issue` finds an active project with an issue nobody is working on. The plugin holds no code: it starts the published `contri-mcp` at an exact version. In chat, where a local server does not run, the skills tell the agent how to make the same check by hand and to say what it could not verify. See [plugin/README.md](plugin/README.md).

## 0.6.1 — a steadier first run

**Fixed**

- After the toolbar button brought you to GitHub from another site, the panel could stay closed when the page finished loading before CONTRI was ready to listen. The extension now keeps asking until the panel itself answers, for about fifteen seconds.

## 0.6.0 — the whole issue list at a glance

**New**

- **Badges on the issue list.** Signed in, every title on a repository's issue list gets the same verdict as the issue page — Looks free, Claimed by @user, Open PR #n, Assigned — so a page can be scanned for the free ones. The whole page is one GraphQL request (latest 20 comments and 20 references per issue, plus Development-panel links). Anonymous lists show no badges, because a page would cost about 75 of the 60 requests an hour. Follows the badge setting: “only when I click” and “off” never check a list.
- **Maintainer @user is on it.** A project-team member who writes “I'll fix this”, “I'm working on it” or “I have a PR for this” used to leave the issue as “Looks free”, because team comments are never contributor claims. It is now its own verdict for 21 days, unless someone on the team hands the issue back (“PRs welcome”, “up for grabs”); after that it is a note on “Looks free”. Triage such as “I can take a look” still does not count. Shown in the badge, the panel, the brief and `contri-mcp`.
- **Latest in the thread, without AI.** Browsers with no built-in on-device model (everything except desktop Chrome today) now show the last three comments, who wrote them and who is on the project team, instead of only a note that summaries are unavailable. No model and no extra request.
- **Report a wrong verdict.** A dedicated issue template; every report becomes a test case.
- **Chrome Web Store publishing from the Release workflow** (`publish-store.yml`): the release ZIP is uploaded and submitted for review automatically once the store credentials are configured, so the store no longer falls behind GitHub releases. Setup in [docs/STORE-SUBMISSION.md](docs/STORE-SUBMISSION.md).
- **CONTRI action for maintainers** (`action/`, `uses: alphasafal/contri/action@main`). On a pull request it checks the issues the pull request closes and posts one comment when someone else already has an open pull request for it, is assigned, claimed it in the last 21 days, or is a maintainer who said the work is theirs. On a schedule it can ask people whose claim went quiet whether they are still on it: once per person per issue. It never closes or blocks anything, runs with the workflow's own token and sends nothing outside GitHub. CONTRI's own repository now uses it. See [action/README.md](action/README.md).
- **Free right now** ([contri-two.vercel.app/issues](https://contri-two.vercel.app/issues)): good first issues that are unassigned, have no open pull request and no claim, in projects where maintainers answer, with each project's typical first reply.
- **Who answers newcomers?** ([contri-two.vercel.app/repos](https://contri-two.vercel.app/repos)): projects ranked by the team's median first reply to outside contributors, with sample sizes, and a `first reply to contributors` README badge for each. Maintainers add their project with one line in `feed/repos.txt`.
- **Open Source Wrapped** ([contri-two.vercel.app/wrapped](https://contri-two.vercel.app/wrapped)): a shareable card of a GitHub user's year — merged pull requests, other people's projects, reviews, busiest month — made in the browser from public data. The username goes to GitHub only.
- The data for the two lists and the badges is static JSON built once a day by the Feed workflow (`feed/`) from the extension's own reports and published on the `feed-data` branch. There is still no CONTRI server.
- `contri-mcp`: `thread: "digest"` on `check_issue` returns the issue head and the last three comments (about 400 tokens) instead of the full transcript (up to ~3,500). `includeThread` still means `thread: "full"`.

**Fixed**

- Automation that runs under an ordinary user account (`k8s-ci-robot`, `aws-cdk-automation`, `dotnet-bot`) is now treated as a bot by its name, so its instant comments no longer count as team replies, reviews or claims. Only a whole part of the login counts, so names like Abbot or Talbot are unaffected.
- Claim detection no longer reads “+1” comments as claims. A claim now needs a first-person offer, an action and a target, so “I can confirm the fix works”, “I'm hitting this too, please fix”, “I'd love to see a fix for this”, “I would expect the parser to handle empty input”, “let me know if you fix it”, “I'll wait for a maintainer to grab this”, “I don't think I can fix this” and workarounds such as “I can fix this locally by…” no longer show an issue as claimed.
- Claim detection recognizes more ways of taking an issue: “I'll open a PR”, “I'll send a patch”, “I would like to contribute to this issue”, “I want to solve this”, “mind if I take a stab at this?”, “I'm on it”, “I have a PR almost ready”, “I've started working on this”, “can I get this assigned?”, “happy to take this one”.
- More ways of giving an issue back are recognized: “I don't have time for this”, “someone else can take this”, “I'm dropping this”.
- The toolbar button on a non-GitHub tab opened GitHub Explore with CONTRI hidden, so a new user saw nothing. It now opens the panel there, on Discover.

**Changed**

- The store name is “CONTRI — Is this GitHub issue free?” and the short description leads with the same question, so store search and the listing say what the extension answers. The README and website open with it too.
- Building needs Node.js 22.12 or newer instead of 24 (CI and releases still use 24).
- Warnings that share a reason are merged into one line (“Open issue count, Open PR count, Merged PR count unavailable. GitHub denied this request”), in the panel and in MCP results.
- One `prefs` read per GitHub page load instead of two.
- The AI panel says that “How do I start?” needs Chrome 148 or later when only the summarizer is available.

## 0.5.0 — audit release

_Extension 0.5.0 · `contri-mcp` 0.2.0._

**New**

- **`check_issues` and `detail: "brief"` in `contri-mcp`.** Agents can check up to 10 issues in one call and ask for the verdict alone (about 40 tokens instead of 200–300), so shortlisting from `find_issues` no longer costs one tool call per issue. Fractional hours are rounded to one decimal and a duplicated field was dropped from `repo_health`.
- **`npx contri-mcp`.** The MCP server is published to npm with provenance (`.github/workflows/publish-mcp.yml`, `mcp-v*` tags); the clone-and-build path remains for unreleased changes.

**Fixed**

- Claim detection: “@bob is already working on this” is news about Bob, not a claim by the commenter; “Is anyone working on this? If not, I'd like to take it” now counts as a claim (the question is dropped, the rest is judged); “I can't finish this week” or “can't work on this today” is a delay, not giving the issue back; a comment that gives back one part and takes another is a claim; “take this opportunity”, “take a look” and “look into whether” no longer claim.
- An open pull request in a fork or another repository that mentions the issue no longer makes it “Open PR #n” (it stays a note), in the badge and in watched issues.
- Anonymous Overview: a full page of closed PRs marks the merge sample as limited even when fewer than 100 were merged, so the chart and author count are no longer shown as the complete 90-day picture.
- Anonymous Team and Discover reports keep their full cache time: the “Anonymous mode samples…” note no longer counts as missing data (it cut the cache to a third and tripled request spend).
- A badge or panel request made just after the previous caller left the page no longer inherits a “Cancelled” error.
- “Last four weeks” is now exactly 28 days (it was 27); the weekly chart buckets are counted back from today.
- Issues with no comments no longer spend a request reading an empty comment page (anonymous mode).
- Firefox package: Settings and sign-in are reachable again (`options_ui`).
- On-device “How do I start?” uses the current Prompt API names (`measureContextUsage`, `contextWindow`), so long threads are trimmed to the model's real context instead of a fixed 8,000 characters. The Prompt API is available to github.com pages from Chrome 148.
- Badges are removed when badges are turned off or the page leaves a repository, instead of lingering until the next navigation.
- Opening the panel from the keyboard focuses it; Escape no longer also reaches GitHub's own handlers; the launcher position is saved once per movement instead of on every key repeat. Section tabs are a proper tab list for screen readers.
- Changing the badge setting applies to open GitHub tabs at once instead of on the next navigation.
- `github.com/education/…`, `/team/…`, `/join/…` and `/watching` are no longer mistaken for repositories.
- A pull request unlinked from the Development panel again no longer leaves a “linked” warning (anonymous).
- Watching an issue whose number matches another watched issue no longer copies the wrong snapshot.
- Settings shows an error if a preference could not be saved; two unhandled promise rejections in the service worker are handled.
- MCP tool descriptions are about a third shorter (`tools/list` costs ~1,700 tokens for 9 tools, down from ~1,860 for 8).

**Security**

- A comment can no longer forge a “(project team)” header or close the `<thread>` tag in the transcript that on-device AI and `check_issue` (`includeThread`) read: lines starting with `---` and `</thread>` inside comment text are neutralised.
- Claim detection ignores text GitHub does not show — HTML comments and collapsed `<details>` — so a hidden “I'll take this” cannot fake a claim or a release.
- Links built from API data must be on `github.com` (or a subdomain), not just `https:`.
- GitHub Actions are pinned to commit SHAs; CI also builds the MCP server.

## 0.4.0 — CONTRI for AI coding agents

**New**

- **`contri-mcp`, CONTRI as an MCP server.** AI coding agents (Claude Code, Cursor, Claude Desktop and others) can now check what the extension shows before they start work: `check_issue`, `repo_health`, `team_responsiveness`, `find_issues`, `discover_projects` and `contribution_brief`, plus the `find_first_issue` and `can_i_take_this` prompts. It uses the same reports and verdicts as the extension, runs locally, is read-only, and returns compact results so agents spend fewer tokens. See [mcp/README.md](mcp/README.md).
- **Sign in with GitHub from your agent.** The agent shows a short code you approve on github.com, with no token to copy, and the sign-in is remembered. A rejected or placeholder token falls back to anonymous instead of breaking every tool.
- **Maybe fixed by #n.** When a merged pull request was linked as closing an issue that is still open, the badge says so instead of “Looks free” (signed in).

**Changed**

- “Looks free” now lists pull requests that were closed without merging (“read why before trying again”) and merged pull requests that only mention the issue. Issues that collect several abandoned attempts are usually harder than they look, or misunderstood. References from other repositories are left out.

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
