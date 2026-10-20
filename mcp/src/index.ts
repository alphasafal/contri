import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { setTransport } from '../../src/background/github';
import { createAuth, defaultCredentialsPath } from './auth';
import { createCache } from './cache';
import { createServer, VERSION } from './server';
import { createContri } from './tools';
import { createTransport } from './transport';

const HELP = `contri-mcp ${VERSION} — CONTRI as an MCP server (stdio)

Checks whether a GitHub issue is free to take, whether a project is alive and
whether maintainers reply. Read-only, public repositories only, no backend.

Signing in (optional, raises GitHub's limit from 60 to 5,000 requests an hour):
  Ask your agent to "sign in to GitHub". The sign_in tool shows a code you
  approve on github.com; no token to copy. The sign-in is saved in
  ${defaultCredentialsPath()}
  (override with CONTRI_MCP_CREDENTIALS). Or set GITHUB_TOKEN / GH_TOKEN to a
  fine-grained token with "Public repositories" and no permissions.

Add it to an MCP client, for example Claude Code:
  claude mcp add --transport stdio contri -- node ${process.argv[1] ?? '/path/to/contri-mcp.js'}
`;

const arg = process.argv[2];
if (arg === '--help' || arg === '-h') {
  process.stdout.write(HELP);
  process.exit(0);
}
if (arg === '--version' || arg === '-v') {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

const auth = createAuth({ autoPoll: true });
const transport = createTransport(auth);
setTransport(transport.fetcher);

// One cache for the whole process: every connection sees the same fresh reports.
const contri = createContri({ auth, cache: createCache(), remaining: transport.remaining });

// stdout carries the protocol, so anything for humans goes to stderr.
const status: { signedIn: boolean; via?: string; note?: string } = auth.status();
process.stderr.write(
  `contri-mcp ${VERSION} ready (${status.signedIn ? `signed in via ${status.via}` : 'anonymous: use the sign_in tool for more requests'})\n`,
);
if (status.note) process.stderr.write(`contri-mcp: ${status.note}\n`);

serveStdio(() => createServer(contri, auth), {
  onerror: (error) => process.stderr.write(`contri-mcp: ${error.message}\n`),
});
