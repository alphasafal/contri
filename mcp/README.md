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
| `find_issues`         | Beginner issues without an assignee; signed in, also whether an open PR already references it | 3 / 2                            |
| `discover_projects`   | Active projects for a language or topic, ranked by recent human merges and good first issues  | 1 / ~7                           |
| `contribution_brief`  | A source-linked brief plus the README, contributing guide, code of conduct and templates      | 2–3 / ~5                         |

Prompts: `find_first_issue` (find an active project and an issue nobody is working on) and `can_i_take_this` (check one issue and say whether to start, ask first or pick another).

Every result carries a `github` field with the sign-in state and the requests GitHub says are left, so an agent can budget and knows when to offer sign-in. Reports are cached in memory for the same times as the extension (issue checks 10 minutes, overview 30 minutes, team 6 hours).

## Set up

Building needs Node.js 22.12 or later (24 recommended); the built server runs on Node.js 20.3 or later. Download and build it once:

```sh
git clone https://github.com/alphasafal/contri ~/contri
cd ~/contri && npm ci && npm run build:mcp      # writes mcp/dist/contri-mcp.js
node mcp/dist/contri-mcp.js --help              # check the install
```

To update later: `cd ~/contri && git pull && npm ci && npm run build:mcp`, then restart your MCP client.

**Claude Code**

```sh
claude mcp add --transport stdio contri -- node ~/contri/mcp/dist/contri-mcp.js
```

**Claude Desktop, Cursor, Windsurf and other clients** that use an `mcpServers` config file. Use full paths: the client does not read your shell setup, so run `which node` and `echo ~/contri` to get them.

```json
{
  "mcpServers": {
    "contri": {
      "command": "/full/path/to/node",
      "args": ["/Users/you/contri/mcp/dist/contri-mcp.js"]
    }
  }
}
```

### Sign in with GitHub

Without signing in, GitHub allows **60 requests an hour**, which an agent uses up quickly. Signing in raises it to 5,000 and lets CONTRI use one GraphQL request instead of dozens. There is no token to copy:

1. Ask your agent to _“sign in to GitHub”_, or just start using CONTRI: when it isn't signed in, it asks you.
2. The agent shows a short code and a link to `github.com/login/device`. Open it, enter the code and approve **CONTRI**.
3. That's it. CONTRI notices the approval by itself and every later call uses it.

This is the same sign-in as the extension: GitHub's device flow with the CONTRI OAuth App, no scopes (public, read-only access), no password through CONTRI. The sign-in is saved for next time in `~/.config/contri/mcp-credentials.json`, readable only by you (set `CONTRI_MCP_CREDENTIALS` to use another path, or ask the agent to sign in with `remember: false` to keep it for this session only). `sign_out` forgets it; revoke it any time at [github.com/settings/applications](https://github.com/settings/applications).

**Prefer a token?** Set `GITHUB_TOKEN` (or `GH_TOKEN`) in the server's `env` to a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with **Public repositories** and every permission at **No access**. If GitHub rejects it, or it is still a placeholder like `PASTE_YOUR_TOKEN_HERE`, CONTRI carries on anonymously and offers to sign in instead of failing.

## Try it

Ask your agent something like:

- “Can I take https://github.com/owner/repo/issues/123?”
- “Find me a good first issue in an active TypeScript project where maintainers reply within a few days.”
- “Before you start on this issue, check nobody else is working on it.”

## Privacy

There is no backend and no analytics. The server sends requests only to GitHub (`api.github.com`, plus `github.com` for the sign-in), and your sign-in only there. Only public repositories are analyzed. Reports are kept in memory and are gone when the process exits; the only file written is the saved sign-in, if you sign in. Issue text goes to your agent only when it asks for it (`check_issue` with `includeThread`). See [PRIVACY.md](https://github.com/alphasafal/contri/blob/main/PRIVACY.md).

## License

MIT
