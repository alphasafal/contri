# Launch kit

Copy-ready text for the repository settings and for sharing CONTRI. Nothing here is posted automatically. Every claim below matches what the extension does today; keep it that way when editing.

**The story in one line:** know whether a GitHub issue is actually available before you spend hours on it.

## Launch order

Do these first, in this order. A post that lands on an old store version or a page without a demo wastes the one chance each channel gives.

1. Ship the current version to the Chrome Web Store and wait for approval.
2. Check on a real repository: issue list badges (signed in), the issue badge, the toolbar button from a non-GitHub tab.
3. Record a 10-second GIF of the badge appearing on an issue and on an issue list; put it at the top of the README and the website.
4. Run the Feed workflow once (Actions → Feed → Run workflow) and look at [/issues](https://contri-two.vercel.app/issues) and [/repos](https://contri-two.vercel.app/repos).
5. Open five real `good first issue`s here (see “First contribution opportunities”).

| When                              | Where                                    | Lead with                                                                 |
| --------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| Day 1, Tue–Thu, 6:30–8:30pm IST   | Show HN                                  | The claimed-issue problem; stay three hours answering                     |
| Day 1                             | X thread, LinkedIn                       | The GIF and the “lost a weekend” story                                    |
| Day 2                             | r/opensource                             | Personal story; ask for wrong verdicts                                    |
| Day 3                             | r/ClaudeAI, r/cursor, MCP Discord        | “Stop your agent opening duplicate PRs” (`npx -y contri-mcp`)             |
| Day 3                             | MCP directories                          | awesome-mcp-servers PR, Smithery, Glama, PulseMCP, mcp.so                 |
| Day 4                             | r/chrome_extensions, r/SideProject       | Short demo                                                                |
| Day 5                             | DEV.to and Hashnode                      | “How I detect claimed GitHub issues”                                      |
| Week 2, Tue–Thu, from 1:30pm IST  | Product Hunt                             | Tagline and gallery below                                                 |
| Week 2                            | Maintainers: r/opensource, X, Discords   | The action: “a bot that tells duplicate PRs the issue is taken”           |
| Week 2                            | Awesome lists, newsletters               | awesome-for-beginners, awesome-chrome-extensions, Console.dev             |
| When the data has a month of runs | Hacker News, X                           | The reply-time study (numbers from `repos.json`, never invented)          |
| 1–20 December                     | X, LinkedIn, Reddit                      | Open Source Wrapped: post your own card first                             |
| Ongoing                           | Other projects' CONTRIBUTING / AGENTS.md | The “before you start” snippet, as a docs PR where you already contribute |

One channel a day, and answer every comment. Never post the same text twice.

## Repository “About” (⚙ next to About on the repo page)

**Description** (GitHub shows ~120 characters in search results):

> 🧭 Know if a GitHub issue is really free before you start: claims, linked PRs, maintainer replies and project activity.

**Website:** `https://contri-two.vercel.app`

**Topics** (20 max):

```
open-source hacktoberfest good-first-issue first-timers first-contributions beginner-friendly open-source-contribution github chrome-extension browser-extension developer-tools github-api contributors maintainers productivity typescript manifest-v3 on-device-ai firefox-extension preact
```

**Social preview:** Settings → General → Social preview → upload [`docs/assets/social-preview.png`](assets/social-preview.png) (1280×640).

Also enable **Discussions** under Settings → Features and pin the repository on your profile.

## One-liners

- **Short:** Know if a GitHub issue is really free before you start.
- **Medium:** CONTRI shows, right on GitHub, whether an issue is already claimed or has a pull request, whether maintainers reply, and whether the project is active.
- **Hook:** Ever spent a weekend on a “good first issue”, only to find someone claimed it in the comments a month ago? CONTRI puts a badge under the issue title that tells you first.

## Release notes

GitHub release notes come from the entry for that version in [CHANGELOG.md](../CHANGELOG.md); the Release workflow keeps them in sync. Work that is not released yet stays under “Unreleased” and never appears on a release page.

## Posts

Chrome Web Store listing: https://chromewebstore.google.com/detail/njglkdpnkbieohopledjohcpkafogbid

### X / Threads / Bluesky

> Before you spend a weekend on a “good first issue”, check it isn't already taken.
>
> CONTRI is a free, open-source extension that adds a badge under GitHub issue titles, and next to every title on an issue list: Looks free · Claimed by `@user` · Claim went quiet · Open PR
>
> Also: how fast maintainers reply, and who they are. No backend, no tracking.
>
> https://chromewebstore.google.com/detail/njglkdpnkbieohopledjohcpkafogbid

### LinkedIn

> Starting in open source is mostly guesswork. Is this project still maintained? Will anyone review my pull request? Is someone already working on that “good first issue”?
>
> I built CONTRI to answer those questions right on GitHub. A badge under each issue title, and next to every title on a project's issue list, says whether it looks free, is assigned, was claimed in the comments (or the claim went quiet), or already has a pull request. The panel shows how quickly the team replies to outside contributors, who actually maintains the project, and 90 days of activity.
>
> It is free and MIT licensed. There is no backend and no tracking, it only reads public repositories, and every number says what it covers. When data is missing it says “unknown”, not zero.
>
> I'd love feedback from contributors and maintainers: https://chromewebstore.google.com/detail/njglkdpnkbieohopledjohcpkafogbid
>
> #opensource #github #developers #hacktoberfest

### Reddit

Read each subreddit's self-promotion rules first (r/opensource, r/github, r/webdev, r/chrome_extensions, r/learnprogramming). Post as a person, answer questions, don't cross-post the same day.

> **I made a free extension that tells you if a GitHub issue is actually free before you start**
>
> As a student trying to contribute, I kept picking “good first issues” that someone had claimed in the comments weeks earlier. CONTRI adds a badge under the issue title (Looks free / Claimed / Claim went quiet / Open PR), and when you're signed in it puts the same badge next to every title on the issue list, so you can scan a page for the free ones. It also shows how fast maintainers reply to outside contributors, and finds maintainers GitHub labels as “contributors”.
>
> It's open source, has no backend, reads public repositories only, and works without signing in (signing in just raises GitHub's rate limit). It's a heuristic, so it says when evidence is incomplete. Feedback very welcome, especially on wrong verdicts: <link>

### For AI-agent users (MCP Discord, r/ClaudeAI, r/cursor, X)

> Your coding agent just opened a PR on an issue someone claimed three days ago. It also spent ~15k tokens reading the thread to decide the issue was "free".
>
> `npx -y contri-mcp` gives Claude Code / Cursor / Codex one tool call that answers it in ~40 tokens: Looks free · Claimed by @x · Claim went quiet · Open PR #n · Assigned — with the evidence links. Batch-check a shortlist of 10 in one call. Read-only, public data only, no server, no token to paste (GitHub device-flow sign-in from inside the agent).
>
> `claude mcp add --transport stdio contri -- npx -y contri-mcp`
>
> https://github.com/alphasafal/contri/tree/main/mcp

**"Before you start" snippet for other projects' AGENTS.md / CONTRIBUTING.md** (offer it in a docs PR to projects you already contribute to; it is a real improvement for their maintainers, and every contributor of theirs sees CONTRI):

> **Before you start on an issue**, check nobody is already working on it: look for an assignee, an "I'd like to work on this" comment, or a linked pull request. The [CONTRI](https://github.com/alphasafal/contri) extension shows this as a badge under the issue title; AI agents can run `npx -y contri-mcp` and call `check_issue` first. If it is taken, pick another issue or ask in the thread.

### Hacker News (Show HN)

**Title:** `Show HN: CONTRI – check if a GitHub issue is already claimed before you start`

**Text:**

> I kept losing evenings to “good first issues” that someone had quietly claimed in the comments. CONTRI is a browser extension that answers “can I work on this?” on the issue page: it checks assignees, “I'd like to work on this”-style comments (and whether that claim went quiet after 21 days), and linked pull requests, including GitHub's Development panel when you're signed in.
>
> It also estimates how quickly the team replies to outside contributors. The roster comes from triage and merge activity and CODEOWNERS, because GitHub reports private org members as “contributor” to outsiders.
>
> No backend: the service worker calls the GitHub API directly, one GraphQL query per report when signed in (OAuth device flow, no scopes) and REST otherwise. Missing data is shown as unknown rather than zero, and samples are labelled. Thread summaries use Chrome's on-device model.
>
> The same checks are an MCP server (`npx -y contri-mcp`), so a coding agent can ask "is this issue free?" in one ~40-token call instead of reading the thread, and never opens a duplicate PR.
>
> Signed in, the issue list gets the same badge next to every title from one GraphQL request for the page. There is also a GitHub Action for maintainers that tells a new pull request when its issue is already taken.
>
> Claim detection is regex-based and English-only for now: a comment counts when it has a first-person offer, an action and a target, which is what keeps “+1, please fix” out. I'd especially like reports of wrong verdicts. Source (MIT): https://github.com/alphasafal/contri

### Product Hunt

- **Name:** CONTRI
- **Tagline (60 max):** Know if a GitHub issue is free before you start
- **Description:** A free, open-source browser extension for open-source contributors. A badge under GitHub issue titles shows whether an issue looks free, is claimed or already has a pull request. A small panel shows maintainer reply times, who maintains the project, and 90 days of activity. No backend, no tracking, public repositories only.
- **First comment:**
  > Hi Product Hunt! I built CONTRI after picking one too many “good first issues” that were already taken. It reads only public GitHub data, works without an account, and tells you when its evidence is incomplete. What would make you trust a project faster? I read every comment.
- **Gallery:** the four `docs/store/screenshot-*.png` plus `docs/store/promo-marquee-1400x560.png`.

### DEV Community

**Title:** `How I detect claimed GitHub issues (and why missing data must never be zero)`

**Outline:**

1. The problem: taken “good first issues” and silent claims.
2. Signals: assignees, claim phrases, linked PRs (closing references vs mentions), the 21-day quiet rule.
3. Finding maintainers when `author_association` lies: triage events, merges, CODEOWNERS.
4. One GraphQL query instead of thirty REST calls; falling back honestly.
5. Reading the newest comments of a 400-comment thread with REST (it lists oldest first).
6. Unknown is not zero: designing honest UI for incomplete evidence.
7. Link the repository and ask for wrong-verdict reports.

### For maintainers: the action (r/opensource, X, maintainer Discords)

> Maintainers: how many pull requests this month were for an issue someone else was already fixing?
>
> I made a small GitHub Action that checks the issue a new pull request closes. If someone else already has an open pull request for it, is assigned, or said “I'd like to work on this” in the last three weeks, it posts one friendly comment on the pull request with the link. It never closes or blocks anything. It can also ask people whose claim went quiet whether they are still on it, once.
>
> It runs with your workflow's own token and sends nothing anywhere else. Six lines of YAML:
>
> https://github.com/alphasafal/contri/tree/main/action

### Free issues list (r/learnprogramming weekly thread, X, LinkedIn, student communities)

> “Good first issue” labels lie: half of them were claimed in the comments weeks ago.
>
> This list is rebuilt every day and only shows good first issues that are unassigned, have no open pull request and no “I'll take this” in the thread, in projects where maintainers actually answer newcomers. It shows each project's typical first reply too.
>
> https://contri-two.vercel.app/issues

### Reply-time study (only once `repos.json` has real runs behind it)

**Title:** `How long do open-source maintainers take to answer a first-time contributor?`

Write it from the published data, with the method up front: which projects, the 90-day window, the sample of 20 pull requests and 20 issues, median not mean, “not enough evidence” counted separately. Link [/repos](https://contri-two.vercel.app/repos) and the raw JSON so anyone can check. Name fast projects; do not shame slow ones (a small sample on a volunteer project is not a verdict). Do not publish a number you have not read in the data.

### Open Source Wrapped (1–20 December: X, LinkedIn, Reddit)

> My open source 2026, in one card. Made mine here, takes ten seconds and only reads public GitHub data: https://contri-two.vercel.app/wrapped
>
> #OpenSourceWrapped

Post your own card as an image, not just the link. Reply to people who post theirs.

## GitHub Discussions welcome post

**Title:** Welcome to CONTRI 👋

> Thanks for stopping by! CONTRI helps you decide where to contribute: whether an issue is really free, whether maintainers reply, and whether a project is active.
>
> - **Questions and ideas:** start a discussion in Q&A or Ideas.
> - **A wrong verdict?** That's the most useful feedback there is. Open an issue with the issue URL and what CONTRI showed (never paste a token).
> - **Want to contribute?** Read CONTRIBUTING.md and pick an issue labelled `good first issue`. CONTRI's own badge will tell you if it's free.
> - **Security problems:** please report privately via Security → Advisories, not here.
>
> Introduce yourself below: what are you hoping to contribute to?

## First contribution opportunities

Real gaps found while preparing 0.3.1. Open them as issues (the `good first issue` template helps) and label them; don't open more than you can review.

1. **Claim phrases beyond English** (`good first issue`): add common Spanish, Portuguese, Hindi, Chinese and other claim and release phrases to `src/core/claims.ts`, with tests in `tests/unit/claims.test.ts`.
2. **Show a “Reload this tab” hint after an update** (`good first issue`): after the extension updates, an already open GitHub tab keeps the old content script, and calls fail with “Extension connection closed”. Detect it and show a one-click reload hint in the panel.
3. **Newest timeline pages for anonymous linked-PR checks** (`help wanted`): REST lists timeline events oldest first; for issues with more than 300 events, read the last pages (like comments already do in `reports/insight.ts`).
4. **Unknown good-first-issue counts in anonymous Discover** (`help wanted`): anonymous ranking treats an unknown count as zero; rank unknowns separately or fetch counts within the request budget.
5. **Component tests for the panel** (`help wanted`): add Preact component tests (for example with `@testing-library/preact`) for `IssueInsight`, `Note` with retry, and `OverviewTab`'s missing-data state.
6. **Keyboard shortcut to toggle the panel** (`good first issue`): add a `commands` entry in the manifest (no new permission) and handle it in the service worker.
7. **Respect `prefers-reduced-transparency`** (`good first issue`, accessibility): use a solid panel background when the user asks for less transparency.
8. **Translations** (`help wanted`): move UI strings to `chrome.i18n` (`_locales/`) starting with the badge and verdict texts.
9. **Firefox Add-ons listing** (`help wanted`): test the `-firefox.zip` on Firefox 128+, including the encrypted remembered sign-in, and document the AMO submission.
10. **Badge anchors for GitHub layout changes** (`good first issue`): when GitHub changes the issue header or the About box, update `issueAnchor()` / `repoAnchor()` in `src/content/badges.ts` and the mock pages. Keep an eye on reports.

## Where else to list it

- Chrome Web Store (see [STORE-SUBMISSION.md](STORE-SUBMISSION.md)) and Firefox Add-ons (AMO also makes it installable on Firefox for Android, the only phone browser that runs it)
- MCP directories, once `npx contri-mcp` resolves: the official [MCP Registry](https://registry.modelcontextprotocol.io) (published automatically by `publish-mcp.yml` from `mcp/server.json`), [Smithery](https://smithery.ai), [Glama](https://glama.ai/mcp/servers), [mcp.so](https://mcp.so), [PulseMCP](https://www.pulsemcp.com), Cursor's MCP directory, and `awesome-mcp-servers`
- Awesome lists: `awesome-for-beginners`, `awesome-first-pr-opportunities`, `awesome-chrome-extensions`, `awesome-github`
- Hacktoberfest: keep a few `good first issue` + `hacktoberfest` labelled issues open in this repository
