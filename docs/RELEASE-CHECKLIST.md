# Release checklist

## Automated (CI does these on every push)

- [ ] `npm run check` — Prettier, ESLint, unit tests, build
- [ ] `npm run test:e2e` — installed extension in Chromium against the mock GitHub, including axe (WCAG 2.2 A/AA)
- [ ] `npm run package && npm run verify:package` — permissions, every referenced file, size, no remote or dynamic code, no source maps or credentials
- [ ] `npm audit --omit=dev` — no known vulnerabilities in shipped dependencies
- [ ] CodeQL clean

## Before a release (opt-in checks)

- [ ] `CONTRI_CONTRAST=1 npx playwright test contrast` — WCAG AA text contrast over the glass, light and dark
- [ ] `CONTRI_PERF=1 CONTRI_BASELINE=<previous dist> npx playwright test perf` — no regression in content-script cost

## Manual, in a real Chrome profile

- [ ] Fresh install opens the welcome page; sign in with GitHub (device flow) and with a token; sign out
- [ ] “Stay signed in”, restart the browser: still signed in. Without it: signed out after restart
- [ ] Revoke the token on GitHub: Settings says the sign-in was rejected
- [ ] Update from the previous version over an existing install: remembered sign-in, shortlist and watched issues survive
- [ ] Keyboard only: Tab through the panel, Escape minimizes and focus lands on the launcher; zoom 200%
- [ ] Launcher on repository pages; widget opens, drags, minimizes, resets; toolbar button toggles it
- [ ] Issue badge on a real issue in light and dark GitHub themes; repository About badge
- [ ] Signed in: badges next to every title on a real repository's issue list (light and dark), still there after filtering, paging and sorting; none when anonymous
- [ ] Toolbar button on a non-GitHub tab opens GitHub with the panel open on Discover
- [ ] SPA navigation: repository → issues → issue → back; no duplicate widgets
- [ ] Team analysis on an active and a quiet repository; archived and fork notes
- [ ] Issues: “First contribution” preset, bulk linked-PR check when signed in, per-issue checks anonymously
- [ ] On-device AI on a Chrome with built-in AI; “Latest in the thread” (last comments, no AI) in a browser without it
- [ ] Watch an issue; notification after a change (use a test repository)
- [ ] Rate-limit message when anonymous capacity runs out

## Publish

1. Update `version` in `package.json` and `public/manifest.json`, and add a `CHANGELOG.md` entry at the top.
2. Merge to `main`. The Release workflow sees a version with no release yet, builds and verifies the Chrome and Firefox packages, creates the `v<version>` tag and publishes a GitHub Release with the changelog entry. (Pushing a `v<version>` tag or running the workflow from the Actions tab does the same.)
3. “Sign in with GitHub” uses the CONTRI OAuth App built into the code; `verify:package` fails if a release has no client ID. Install the release ZIP and confirm Settings shows the button. (The optional repository variable `CONTRI_GITHUB_CLIENT_ID` overrides it.)
4. Chrome Web Store: with the store credentials configured, the Release workflow uploads the Chrome ZIP and submits it for review (see [STORE-SUBMISSION.md](STORE-SUBMISSION.md)). Without them, upload the ZIP in the Developer Dashboard. Either way, confirm a few days later that the store shows the new version.

## Publish `contri-mcp`, then the Claude plugin

The plugin starts `contri-mcp` at an exact version, and that version has to be on npm already. So the server is released first and the plugin follows.

1. Set the new version in `mcp/package.json`, `mcp/server.json` (twice) and `VERSION` in `mcp/src/server.ts`. `npm test` fails if `VERSION` differs from `mcp/package.json`, and the publish workflow fails if `server.json` does.
2. Merge to `main` and push the `mcp-v<version>` tag. The Publish contri-mcp workflow publishes to npm and updates the MCP Registry. The plugin keeps starting the previous version meanwhile, which is fine.
3. When the version is on npm, change the `contri-mcp@<version>` argument in `plugin/.mcp.json` and raise `version` in `plugin/.claude-plugin/plugin.json`. `npm test` fails if the plugin names a version ahead of `mcp/package.json`.
4. Raise the plugin's `version` for every other plugin change too, including a skill-only one: Claude Code only offers an update when the version changes.
5. The Claude plugin directory picks up the commit from `main` by itself; confirm the new version in the developer portal at claude.ai/directory/manage, and select **Re-validate** there before relying on it. Never rename the plugin (`contri`): installs are recorded under that name.
6. Do not add a `package.json`, a lockfile or a `node_modules` path to `plugin/`. The directory refuses a server that runs from `node_modules`, and it holds a lockfile install for review and will later accept one only from Verified organizations; `tests/unit/plugin.test.ts` fails on all three.
