# contri-mcp

**CONTRI for AI coding agents.** Before your agent starts on a GitHub issue, it can check what [CONTRI](https://github.com/alphasafal/contri) shows people in the browser: is someone already working on it, is the project alive, and will a maintainer reply?

- **No duplicate work.** Agents increasingly open pull requests on issues someone already claimed. `check_issue` finds assignees, “I'd like to work on this” comments (and claims that went quiet) and open pull requests that reference the issue.
- **Same numbers as the extension.** The server reuses CONTRI's own reports and verdict logic, so the answer matches the badge on github.com.
- **Read-only, local, public data only.** It runs on your machine over stdio, talks only to `api.github.com`, and never comments, claims or opens pull requests.

## Tools

| Tool                  | Answers                                                                                       | Requests (signed in / anonymous) |
| --------------------- | --------------------------------------------------------------------------------------------- | -------------------------------- |
| `check_issue`         | Can I take this issue? Looks free, Claimed by @x, Claim went quiet, Open PR #n, Assigned…     | 1–2 / ~4                         |
| `repo_health`         | Is it alive? PRs merged in 90 days (bots excluded), human authors, time to merge, release     | 2 / ~7                           |
| `team_responsiveness` | Will someone reply? First team reply to outside PRs and issues, who is waiting, maintainers   | 2–3 / ~25                        |
| `find_issues`         | Beginner issues without an assignee; signed in, also whether an open PR already references it | 2 / 2 + 3 per issue              |
| `discover_projects`   | Active projects for a language or topic, ranked by recent human merges and good first issues  | 1 / ~7                           |
| `contribution_brief`  | A source-linked brief plus the README, contributing guide, code of conduct and templates      | 2–3 / ~5                         |

Prompts: `find_first_issue` (find an active project and an issue nobody is working on) and `can_i_take_this` (check one issue and say whether to start, ask first or pick another).

Every result carries a `github` field with the requests GitHub says are left, so an agent can budget. Reports are cached in memory for the same times as the extension (issue checks 10 minutes, overview 30 minutes, team 6 hours).

## Set up

Requires Node.js 20.3 or later.

A token is optional but strongly recommended: without one GitHub allows **60 requests an hour**, which an agent uses up quickly. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new), choose **Public repositories**, and leave every permission at **No access**. That raises the limit to 5,000 an hour and lets CONTRI use one GraphQL request instead of dozens.

**Claude Code**

```sh
claude mcp add --env GITHUB_TOKEN=github_pat_... --transport stdio contri -- npx -y contri-mcp
```

**Claude Desktop, Cursor, Windsurf and other clients** that use an `mcpServers` config file:

```json
{
  "mcpServers": {
    "contri": {
      "command": "npx",
      "args": ["-y", "contri-mcp"],
      "env": { "GITHUB_TOKEN": "github_pat_..." }
    }
  }
}
```

`GH_TOKEN` works too. Run `npx contri-mcp --help` to check the install.

### From source

```sh
git clone https://github.com/alphasafal/contri && cd contri
npm ci
npm run build:mcp      # writes mcp/dist/contri-mcp.js
```

Then point your client at `node /path/to/contri/mcp/dist/contri-mcp.js`.

## Try it

Ask your agent something like:

- “Can I take https://github.com/owner/repo/issues/123?”
- “Find me a good first issue in an active TypeScript project where maintainers reply within a few days.”
- “Before you start on this issue, check nobody else is working on it.”

## Privacy

There is no backend and no analytics. The server sends requests only to `api.github.com`, and your token only there. Only public repositories are analyzed. Reports are kept in memory and are gone when the process exits; nothing is written to disk. Issue text goes to your agent only when it asks for it (`check_issue` with `includeThread`). See [PRIVACY.md](https://github.com/alphasafal/contri/blob/main/PRIVACY.md).

## License

MIT
