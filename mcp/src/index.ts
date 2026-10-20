import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { setTransport } from '../../src/background/github';
import { createCache } from './cache';
import { createServer, VERSION } from './server';
import { createContri } from './tools';
import { createTransport } from './transport';

const HELP = `contri-mcp ${VERSION} — CONTRI as an MCP server (stdio)

Checks whether a GitHub issue is free to take, whether a project is alive and
whether maintainers reply. Read-only, public repositories only, no backend.

Environment:
  GITHUB_TOKEN   Optional. A read-only token raises GitHub's limit from 60 to
                 5,000 requests an hour and enables GraphQL (GH_TOKEN also works).
                 A fine-grained token set to "Public repositories" with every
                 permission at "No access" is enough.

Add it to an MCP client, for example Claude Code:
  claude mcp add --env GITHUB_TOKEN=github_pat_... --transport stdio contri -- npx -y contri-mcp
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

const token = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim() || undefined;
const transport = createTransport(token);
setTransport(transport.fetcher);

// One cache for the whole process: every connection sees the same fresh reports.
const contri = createContri({ authed: Boolean(token), cache: createCache(), remaining: transport.remaining });

// stdout carries the protocol, so anything for humans goes to stderr.
process.stderr.write(
  `contri-mcp ${VERSION} ready (${token ? 'signed in' : 'anonymous: 60 requests/hour, set GITHUB_TOKEN for more'})\n`,
);

serveStdio(() => createServer(contri), {
  onerror: (error) => process.stderr.write(`contri-mcp: ${error.message}\n`),
});
