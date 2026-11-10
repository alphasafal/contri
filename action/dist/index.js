import { appendFileSync, readFileSync } from "node:fs";
// src/background/github.ts
/**
* Thin GitHub client used by every report. REST for anonymous use, GraphQL when
* signed in (one GraphQL query replaces dozens of REST calls).
*/
var API = "https://api.github.com";
var TIMEOUT_MS = 18e3;
var MEMORY_TTL = 3e5;
var MEMORY_MAX = 200;
/** Requests kept in reserve so the user is never left at zero mid-task. */
var RESERVE = 3;
var GitHubError = class extends Error {
	status;
	reset;
	constructor(message, status, reset) {
		super(message);
		this.status = status;
		this.reset = reset;
		this.name = "GitHubError";
	}
};
var transport = (url, init) => fetch(url, init);
function setTransport(next) {
	transport = next;
}
var memory = /* @__PURE__ */ new Map();
function clearMemory() {
	memory.clear();
}
function resourceOf(url) {
	if (url.endsWith("/graphql")) return "graphql";
	if (url.startsWith(`https://api.github.com/search/`)) return "search";
	return "core";
}
var GitHubClient = class {
	signal;
	requests = 0;
	remaining = {};
	reset = {};
	constructor(signal) {
		this.signal = signal;
	}
	/** Remaining capacity GitHub last reported for the core (REST) or graphql resource. */
	left(resource = "core") {
		return this.remaining[resource] ?? null;
	}
	async send(url, init = {}) {
		const resource = resourceOf(url);
		const left = this.remaining[resource];
		if (resource !== "search" && left !== void 0 && left <= RESERVE) throw new GitHubError("Keeping a small GitHub request reserve. Sign in for more capacity, or try again after the limit resets.", 429, this.reset[resource]);
		const timeout = AbortSignal.timeout(TIMEOUT_MS);
		let response;
		try {
			response = await transport(url, {
				...init,
				headers: {
					Accept: "application/vnd.github+json",
					"X-GitHub-Api-Version": "2022-11-28",
					...init.headers
				},
				credentials: "omit",
				referrerPolicy: "no-referrer",
				signal: this.signal ? AbortSignal.any([this.signal, timeout]) : timeout
			});
		} catch (error) {
			if (this.signal?.aborted) throw error;
			if (error instanceof Error && /slow down|sign-in|Connection changed|Cancelled/.test(error.message)) throw error;
			throw new GitHubError(error instanceof Error && error.name === "TimeoutError" ? "GitHub took too long to reply. Try again shortly." : "Unable to reach GitHub. Check your connection.", 0);
		}
		this.requests++;
		const headerResource = response.headers.get("x-ratelimit-resource") ?? resource;
		const remaining = response.headers.get("x-ratelimit-remaining");
		if (remaining !== null) this.remaining[headerResource] = Number(remaining);
		const reset = Number(response.headers.get("x-ratelimit-reset"));
		if (reset) this.reset[headerResource] = reset;
		if (!response.ok) {
			const body = await response.json().catch(() => ({}));
			const limited = response.status === 429 || remaining === "0" || /rate limit|secondary rate|abuse detection/i.test(body.message ?? "");
			const when = reset ? ` Try after ${(/* @__PURE__ */ new Date(reset * 1e3)).toLocaleTimeString()}.` : " Try again later.";
			throw new GitHubError(limited ? `GitHub request limit reached.${when} Signing in raises the limit.` : response.status === 404 ? "Not found on GitHub. It may be private, renamed or deleted." : response.status === 403 ? "GitHub denied this request (forbidden)." : response.status === 409 ? "This repository is empty: it has no commits yet." : response.status === 422 ? "GitHub could not run this search. Try simpler terms." : `GitHub returned ${response.status}. Try again later.`, response.status, reset || void 0);
		}
		return response;
	}
	/** GET a REST path (e.g. `/repos/o/r`). Identical paths are reused for five minutes. */
	async rest(path) {
		const cached = memory.get(path);
		if (cached && Date.now() - cached.at < MEMORY_TTL) return cached.value;
		const value = await (await this.send(API + path)).json();
		memory.set(path, {
			at: Date.now(),
			value
		});
		if (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value);
		return value;
	}
	/** GET a REST list path, following pagination up to `maxPages`. */
	async restAll(path, maxPages = 3) {
		const values = [];
		for (let page = 1; page <= maxPages; page++) {
			const rows = await this.rest(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
			values.push(...rows);
			if (rows.length < 100) return {
				values,
				complete: true
			};
		}
		return {
			values,
			complete: false
		};
	}
	async graphql(query, variables) {
		const body = await (await this.send(`${API}/graphql`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				query,
				variables
			})
		})).json();
		const errors = (body.errors ?? []).map((e) => e.message);
		if (body.errors?.some((e) => e.type === "RATE_LIMITED")) throw new GitHubError("GitHub GraphQL limit reached. Try again later.", 429);
		if (!body.data) {
			const notFound = body.errors?.some((e) => e.type === "NOT_FOUND");
			throw new GitHubError(notFound ? "Not found on GitHub. It may be private, renamed or deleted." : errors[0] || "GitHub GraphQL request failed.", notFound ? 404 : 502);
		}
		return {
			data: body.data,
			errors
		};
	}
};
var splitRepo = (repo) => {
	const [owner, name] = repo.split("/");
	return {
		owner,
		name
	};
};
// src/core/metrics.ts
/**
* Pure evidence calculations. Everything here works on normalized data so the
* REST (anonymous) and GraphQL (signed-in) paths produce identical numbers.
*/
var DAY = 864e5;
var TEAM_ASSOCIATIONS = /* @__PURE__ */ new Set([
	"OWNER",
	"MEMBER",
	"COLLABORATOR"
]);
/**
* Automation that runs under an ordinary user account, which GitHub does not mark as a bot:
* "k8s-ci-robot", "aws-cdk-automation", "dotnet-bot". Only a whole part of the name counts,
* so people called Abbot or Talbot stay people.
*/
var BOT_NAME = /(?:^|[-_])(?:bots?|robot|autobot|automation)(?:[-_]|$)/i;
/** Normalizes a REST `user` object or a GraphQL `author` object. */
function actor(value) {
	if (!value?.login) return null;
	const bot = value.type === "Bot" || value.__typename === "Bot" || /\[bot\]$/i.test(value.login) || BOT_NAME.test(value.login);
	return {
		login: value.login,
		bot
	};
}
var isHuman = (who) => Boolean(who && !who.bot);
var isTeamAssociation = (association) => TEAM_ASSOCIATIONS.has(association ?? "");
function linkState(prs, complete) {
	if (prs.some((p) => p.state.toLowerCase() === "open")) return "open";
	return complete ? "clear" : "incomplete";
}
function hasNextIssuePage(rawCount, total, page, perPage = 30) {
	return page < 10 && rawCount === perPage && page * perPage < total;
}
function discussionSummary(replies, complete, isTeam) {
	const human = replies.filter((r) => isHuman(r.author) && Date.parse(r.at) <= Date.now()).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
	const last = human[0];
	return {
		complete,
		inspected: replies.length,
		teamComments: human.filter((r) => isTeam(r.author.login, r.association)).length,
		latest: last ? {
			at: last.at,
			url: last.url,
			login: last.author.login,
			kind: "comment"
		} : null
	};
}
// src/background/reports/context.ts
function createCtx(authed, signal) {
	return {
		client: new GitHubClient(signal),
		authed,
		signal,
		now: /* @__PURE__ */ new Date()
	};
}
/** Runs an optional request: failures become a warning instead of failing the whole report. */
async function optional(ctx, warnings, label, run, options = {}) {
	try {
		return await run();
	} catch (error) {
		if (ctx.signal?.aborted) throw error;
		if (error instanceof GitHubError && options.quietStatus?.includes(error.status)) return null;
		warnings.push(`${label} unavailable. ${error instanceof Error ? error.message : ""}`.trim());
		return null;
	}
}
/** Uses GraphQL when signed in, falling back to REST (with a note) if GraphQL fails. */
async function preferGraphql(ctx, graphql, rest) {
	if (!ctx.authed) return rest();
	try {
		return await graphql();
	} catch (error) {
		if (ctx.signal?.aborted || error instanceof GitHubError && [404, 429].includes(error.status)) throw error;
		const result = await rest();
		result.warnings?.push(`Used the standard API because GraphQL failed: ${error instanceof Error ? error.message : "unknown error"}`);
		return result;
	}
}
var restComment = (c) => ({
	author: actor(c.user),
	association: c.author_association ?? "NONE",
	at: c.created_at ?? "",
	url: c.html_url ?? "",
	kind: "comment",
	body: c.body ?? void 0
});
var gqlComment = (c) => ({
	author: actor(c.author),
	association: c.authorAssociation,
	at: c.createdAt,
	url: c.url,
	kind: "comment",
	body: c.body
});
var COMMENT_FIELDS = `author { login __typename } authorAssociation createdAt url`;
var INTENT = [
	String.raw`i(?:'?d| would)(?: really| also| still| definitely)? (?:like|love|be (?:happy|glad|willing|keen|able|interested))`,
	String.raw`i(?:'?m| am)(?: really| also| still| definitely)? (?:happy|glad|willing|keen|going|planning|trying|ready|interested|gonna|able)`,
	String.raw`i (?:want|wanna|wish|plan|intend|hope)`,
	String.raw`i(?:'?ll| will| shall| can| could)`,
	String.raw`let me`,
	String.raw`(?:can|could|may|might) i`,
	String.raw`(?:mind|ok|okay|alright|fine|cool) if i`,
	String.raw`(?:happy|glad|willing|would love|love) to`
].join("|");
/** "I don't think I can fix this" and "not sure I can take it" are doubts, not offers. */
var DOUBT = String.raw`(?<!\b(?:do(?:n'?t| not) (?:think|believe)|not sure|unsure|doubt)\s+(?:that\s+|if\s+|whether\s+)?)`;
/**
* Words allowed between the intent and the action ("I'd like to *try to* fix this").
* A refusal, or a clause about somebody else ("let me know if *you* fix it",
* "I'll *wait* for a *maintainer* to grab this"), ends the match.
*/
var GAP = String.raw`(?:(?!'t\b|n't\b|\b(?:not|never|unable|cannot|no longer|you|your|they|them|he|she|someone|somebody|anyone|anybody|nobody|who|whoever|how|if|whether|unless|until|wait|waiting|know|see|ask|wonder|expect|maintainers?|confirm|reproduce)\b)[^.?!\n]){0,40}?`;
var THING = String.raw`(?:issues?|bugs?|problem|task|ticket|feature|fix|part|one|typo|error|crash|docs?|documentation|tests?|work|piece|side|change|request|item)`;
/**
* What is being taken: "this", "it", "the backend fix", "#123". "Take this opportunity",
* "take that into account" and "fix this in my app" (a workaround) are not about the issue.
*/
var NOT_THE_ISSUE = String.raw`(?! (?:opportunity|chance|way|approach|workaround|offline|into|as|seriously|personally|locally|(?:in|on|for) (?:my|our) (?:own |local )?(?:app|project|code|codebase|repo|fork|setup|case|end|side|machine|env|environment|build))\b)`;
var TARGET = String.raw`(?:(?:this|it|that|these|those)\b${NOT_THE_ISSUE}|(?:the|a|an) (?:[\w-]+ ){0,2}${THING}\b|#\d+)`;
var VERB = String.raw`(?:work(?:ing)? on|contribut(?:e|ing) to|tak(?:e|ing)(?: up| on| over| care of)?|pick(?:ing)? up|grab(?:bing)?|claim(?:ing)?|handl(?:e|ing)|tackl(?:e|ing)|fix(?:ing)?|solv(?:e|ing)|resolv(?:e|ing)|address(?:ing)?|implement(?:ing)?|look(?:ing)? into|investigat(?:e|ing)|debug(?:ging)?|patch(?:ing)?|(?:get(?:ting)? )?start(?:ed|ing)? on)`;
var PR_NOUN = String.raw`(?:a|an|the|my) (?:[\w-]+ ){0,2}(?:prs?|pull requests?|merge requests?|patch|fix)\b`;
var SEND_PR = String.raw`(?:open(?:ing)?|submit(?:ting)?|send(?:ing)?|rais(?:e|ing)|creat(?:e|ing)|mak(?:e|ing)|put(?:ting)? up|fil(?:e|ing)|push(?:ing)?|prepar(?:e|ing)|draft(?:ing)?|writ(?:e|ing)|post(?:ing)?|contribut(?:e|ing)|provid(?:e|ing)) (?:up )?${PR_NOUN}`;
var ACTION = [
	`${VERB} ${TARGET}`,
	String.raw`pick(?:ing)? (?:this|it|that)(?: one)? up\b`,
	SEND_PR,
	String.raw`giv(?:e|ing) (?:this|it|that)(?: one)? a (?:try|shot|go|stab|crack|whirl)\b`,
	String.raw`(?:tak(?:e|ing)|hav(?:e|ing)) a (?:stab|shot|crack|swing|go|whack) at\b`,
	String.raw`(?:be|get) assigned\b`,
	String.raw`get (?:this|it|that) assigned\b`
].join("|");
var WORKING_ON = String.raw`working on (?:this|it|that|a fix|the fix|a patch|a pr|the pr)\b`;
/** Things only someone already doing the work says: "I've started on this", "I opened a PR", "I have a fix". */
var UNDERWAY = [
	String.raw`\bi(?:'?m| am) on (?:it|this)\b`,
	String.raw`\bi(?:'ve| have)?(?: already| just)? (?:started|begun) (?:work(?:ing)? on|on|fixing|implementing|looking into) ${TARGET}`,
	String.raw`\bi(?:'ve| have)?(?: already| just)? (?:opened|submitted|created|pushed|sent|raised|made|put up|written|drafted|filed) ${PR_NOUN}`,
	String.raw`\bi(?:'ve| have|'ve got| have got| got) (?:a|an|my) (?:[\w-]+ ){0,2}(?:prs?|pull requests?|patch|fix|branch)\b`,
	String.raw`^\s*(?:just |already )?started (?:work(?:ing)? on|on) ${TARGET}`
];
var CLAIM_PATTERNS = [
	new RegExp(String.raw`${DOUBT}\b(?:${INTENT})\b${GAP}\b(?:${ACTION})`, "i"),
	/\b(?:please )?assign (?:this |it )?(?:issue )?(?:to )?me\b/i,
	/\bassign(?:ed)? to me\b/i,
	/^\s*\/(?:assign|take|claim)\b/im,
	new RegExp(String.raw`(?:^|\b(?:i'?m|i am)\s+(?:already |currently |now |still )?)${WORKING_ON}`, "im"),
	/^\s*on it\b/im,
	/(?:^\s*|\bi call(?:ing)? )dibs\b/im,
	...UNDERWAY.map((p) => new RegExp(p, "im"))
];
/**
* A maintainer who writes "I can take a look" or "can I help?" is triaging, not taking the
* issue. Only statements that the work is theirs or under way count for the project team:
* "I'll fix this", "I'm working on it", "I have a PR for this".
*/
var TEAM_PATTERNS = [
	new RegExp(String.raw`${DOUBT}\bi(?:'?ll| will|'?m going to| am going to|'?m gonna)\b${GAP}\b(?:(?:fix|handle|tackle|take care of|take|pick up|implement|address|patch|work on|sort) ${TARGET}|${SEND_PR})`, "i"),
	new RegExp(String.raw`(?:^|\b(?:i'?m|i am)\s+(?:already |currently |now |still )?)${WORKING_ON}`, "im"),
	/^\s*on it\b/im,
	...UNDERWAY.map((p) => new RegExp(p, "im"))
];
/** The team handing an issue to the community cancels an earlier "I'll fix this" from the team. */
var TEAM_OPEN_PATTERNS = [
	/\b(?:prs?|pull requests?|contributions?|patches|a pr|a pull request|a patch) (?:(?:are|is|would be|very|most|always|more than) )*welcomed?\b/i,
	/\bup for grabs\b/i,
	/\bhelp (?:is )?wanted\b/i,
	/\bfeel free to\b/i,
	/\bhappy to (?:review|accept|merge|take a (?:pr|pull request|patch))\b/i,
	/\banyone (?:can|is welcome to|who wants to|interested)\b/i
];
var RELEASE_PATTERNS = [
	/\b(?:no longer|not) (?:working|able to work) on\b/i,
	/\bunassign me\b/i,
	/\bfeel free to (?:take|pick|grab)\b/i,
	/\b(?:won'?t|can'?t|cannot|unable to|not going to) (?:be able to )?(?:(?:work on|finish|fix|take) (?:this|it)\b(?! ?(?:week|month|year|today|tonight|tomorrow|weekend|sprint|morning|afternoon|evening|until|before|by |right now|now\b))|continue(?: (?:with )?(?:this|it))?(?=[\s,.!]*$|[.,!]))/im,
	/\b(?:don'?t|do not|won'?t|will not|no longer) have (?:the |enough )?(?:time|bandwidth|capacity)\b/i,
	/\bsomeone else (?:can|could|should|may|is welcome to) (?:take|pick|grab|have|work on)\b/i,
	/\b(?:i'?m|i am) (?:dropping|abandoning|giving up on|stepping (?:away|back) from) (?:this|it)\b/i
];
/**
* "Is anyone working on this?" is a question, not a claim, but what follows it often
* is ("if not, I'd like to take it"). The question is dropped and the rest is judged.
*/
var QUESTION_ABOUT_OTHERS = /^[^.?!\n]*\b(?:is |has )?(?:anyone|someone|somebody|anybody)\b[^.?!\n]*\bworking on\b[^.?!\n]*[?.!]?/gim;
function isClaimText(text) {
	const body = stripQuotes(text).replace(QUESTION_ABOUT_OTHERS, " ");
	return CLAIM_PATTERNS.some((p) => p.test(body));
}
var isReleaseText = (text) => RELEASE_PATTERNS.some((p) => p.test(stripQuotes(text)));
/** A project-team statement that the work is theirs or already under way. */
var isTeamClaimText = (text) => {
	const body = stripQuotes(text).replace(QUESTION_ABOUT_OTHERS, " ");
	return TEAM_PATTERNS.some((p) => p.test(body));
};
/** The project team inviting others to take the issue ("PRs welcome", "feel free to pick this up"). */
var isTeamOpenText = (text) => {
	const body = stripQuotes(text);
	return TEAM_OPEN_PATTERNS.some((p) => p.test(body)) || RELEASE_PATTERNS.some((p) => p.test(body));
};
/**
* Ignores quoted replies (`> ...`), code blocks and text GitHub does not show \u2014
* HTML comments and collapsed `<details>` \u2014 so we judge only what the person
* visibly wrote and a hidden "I'll take this" cannot fake a claim.
* Curly apostrophes (smart quotes on phones and macOS) are treated as straight ones.
*/
function stripQuotes(text) {
	return text.replace(/[\u2018\u2019]/g, "'").replace(/```[\s\S]*?```/g, " ").replace(/<!--[\s\S]*?(?:-->|$)/g, " ").replace(/<details\b[\s\S]*?(?:<\/details\s*>|$)/gi, " ").split("\n").filter((line) => !line.trimStart().startsWith(">")).join("\n");
}
function detectClaims(comments, isTeam) {
	const released = /* @__PURE__ */ new Map();
	const claims = [];
	const ordered = [...comments].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
	for (const c of ordered) {
		if (!isHuman(c.author) || !c.body || isTeam(c.author.login, c.association)) continue;
		const login = c.author.login;
		if (isClaimText(c.body)) claims.push({
			login,
			at: c.at,
			url: c.url,
			text: summarize(c.body)
		});
		else if (isReleaseText(c.body)) released.set(login.toLowerCase(), Date.parse(c.at));
	}
	return claims.filter((claim) => {
		const releasedAt = released.get(claim.login.toLowerCase());
		return releasedAt === void 0 || releasedAt < Date.parse(claim.at);
	});
}
/**
* The latest "I'll fix this" / "I'm working on it" from the project team, unless someone on
* the team later opened the issue to contributors ("PRs welcome"). Outside contributors'
* offers are handled by `detectClaims`.
*/
function detectTeamClaim(comments, isTeam, now = Date.now()) {
	let found;
	const ordered = [...comments].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
	for (const c of ordered) {
		if (!isHuman(c.author) || !c.body || !isTeam(c.author.login, c.association)) continue;
		if (isTeamClaimText(c.body)) found = {
			login: c.author.login,
			at: c.at,
			url: c.url,
			text: summarize(c.body)
		};
		else if (isTeamOpenText(c.body)) found = void 0;
	}
	if (!found) return void 0;
	const claimant = found.login.toLowerCase();
	const lastActivity = Math.max(Date.parse(found.at), ...comments.filter((c) => c.author?.login.toLowerCase() === claimant).map((c) => Date.parse(c.at)).filter(Number.isFinite));
	const ageDays = Math.max(0, Math.floor((now - lastActivity) / DAY));
	return {
		claim: found,
		ageDays,
		fresh: ageDays <= 21
	};
}
var ago$1 = (days) => days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`;
function summarize(body) {
	const line = stripQuotes(body).replace(/\s+/g, " ").trim();
	return line.length > 140 ? `${line.slice(0, 137)}…` : line;
}
function claimStatus(input) {
	const now = input.now ?? Date.now();
	const { assignees } = input;
	if (assignees.length) return {
		state: "assigned",
		assignees,
		note: `Assigned to ${assignees.map((a) => `@${a}`).join(", ")}. Ask in the thread before starting.`
	};
	const claim = detectClaims(input.comments, input.isTeam).at(-1);
	const team = detectTeamClaim(input.comments, input.isTeam, now);
	const teamNote = team ? ` @${team.claim.login} from the project team said they are working on it ${ago$1(team.ageDays)}.` : "";
	if (!claim) return {
		state: "none",
		assignees,
		...team ? { team } : {},
		note: team ? `No claim from outside contributors.${teamNote}` : "No public claim found in the comments."
	};
	const claimant = claim.login.toLowerCase();
	const prAuthors = new Set(input.openPrAuthors.map((a) => a.toLowerCase()));
	const lastActivity = Math.max(Date.parse(claim.at), ...input.comments.filter((c) => c.author?.login.toLowerCase() === claimant).map((c) => Date.parse(c.at)).filter(Number.isFinite));
	const ageDays = Math.floor((now - lastActivity) / DAY);
	const shared = {
		claim,
		assignees,
		ageDays,
		...team ? { team } : {}
	};
	if (prAuthors.has(claimant)) return {
		state: "claimed",
		...shared,
		note: `@${claim.login} has an open pull request for this.`
	};
	if (ageDays > 21) return {
		state: "stale",
		...shared,
		note: `@${claim.login} offered to work on this ${ageDays} days ago with no linked pull request since. It may be free — ask politely in the thread first.${teamNote}`
	};
	return {
		state: "claimed",
		...shared,
		note: `@${claim.login} offered to work on this ${ago$1(ageDays)}.`
	};
}
// src/core/team.ts
function teamCheck(roster) {
	return (login, association) => isTeamAssociation(association) || roster.has(login.toLowerCase());
}
// src/shared/repo.ts
/** Top-level GitHub paths that look like `owner/name` but are not repositories. */
var RESERVED_OWNERS = /* @__PURE__ */ new Set([
	"about",
	"account",
	"advisories",
	"apps",
	"codespaces",
	"collections",
	"contact",
	"copilot",
	"customer-stories",
	"dashboard",
	"discussions",
	"education",
	"enterprise",
	"events",
	"explore",
	"features",
	"github-copilot",
	"issues",
	"join",
	"login",
	"logout",
	"marketplace",
	"models",
	"new",
	"notifications",
	"orgs",
	"organizations",
	"premium-support",
	"pricing",
	"pulls",
	"readme",
	"resources",
	"search",
	"security",
	"sessions",
	"settings",
	"signup",
	"site",
	"solutions",
	"sponsors",
	"stars",
	"team",
	"topics",
	"trending",
	"users",
	"watching"
]);
var OWNER = /^[a-z\d](?:[a-z\d-]{0,38})$/i;
var NAME = /^[a-z\d_.-]{1,100}$/i;
/**
* Normalizes `owner/name`, `github.com/owner/name` or a full GitHub URL to `owner/name`.
* Returns null for anything that is not a plausible public repository path.
*/
function parseRepo(input) {
	let value = input.trim().replace(/\/+$/, "");
	if (/^https?:\/\//i.test(value)) try {
		const url = new URL(value);
		if (!["github.com", "www.github.com"].includes(url.hostname.toLowerCase())) return null;
		value = url.pathname.replace(/^\/+/, "");
	} catch {
		return null;
	}
	else value = value.replace(/^(?:www\.)?github\.com\//i, "");
	const [owner, rawName] = value.split("/");
	const name = rawName?.replace(/\.git$/i, "");
	if (!owner || !name || !OWNER.test(owner) || !NAME.test(name) || name === "." || name === "..") return null;
	if (RESERVED_OWNERS.has(owner.toLowerCase())) return null;
	return `${owner}/${name}`;
}
function repoPath(repo) {
	const parsed = parseRepo(repo);
	if (!parsed) throw new Error("Enter a public repository as owner/name or a GitHub repository URL.");
	return `/repos/${parsed.split("/").map(encodeURIComponent).join("/")}`;
}
// src/background/reports/repo.ts
/** Every report starts here: CONTRI only ever reads public repositories. */
async function publicRepo(ctx, repo) {
	const r = await ctx.client.rest(repoPath(repo));
	if (r.private) throw new Error("Only public repositories are supported.");
	return {
		fullName: r.full_name,
		name: r.name,
		owner: {
			login: r.owner?.login ?? repo.split("/")[0],
			type: r.owner?.type ?? "User"
		},
		url: r.html_url,
		description: r.description,
		fork: r.fork,
		archived: r.archived,
		disabled: r.disabled,
		pushedAt: r.pushed_at,
		stars: r.stargazers_count,
		forks: r.forks_count,
		language: r.language,
		license: r.license?.name ?? null,
		hasIssues: r.has_issues !== false,
		topics: r.topics ?? [],
		defaultBranch: r.default_branch ?? "main",
		parent: r.parent?.full_name ?? null
	};
}
// src/background/reports/insight.ts
var THREAD_LIMIT = 14e3;
/**
* Comment text cannot forge a transcript header or close the `<thread>` tag the
* on-device prompt wraps it in: a line starting with `---` could otherwise claim
* to be from "@maintainer (project team)".
*/
function neutralizeThreadBody(body) {
	return body.replace(/^[ \t]*---/gm, "—").replace(/<\/?thread\b/gi, "[thread");
}
/** Builds a compact transcript: the issue first, then the most recent comments that fit. */
function threadText(issue, replies, isTeam) {
	const head = `Issue: ${issue.title}\nOpened by @${issue.author ?? "ghost"}\n\n${neutralizeThreadBody((issue.body || "(no description)").slice(0, 5e3))}\n`;
	const parts = [];
	let used = head.length;
	let truncated = issue.body.length > 5e3;
	const ordered = [...replies].filter((r) => r.body).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
	for (const r of ordered) {
		const block = `\n--- ${r.author ? `@${r.author.login}${isTeam(r.author.login, r.association) ? " (project team)" : ""}` : "@ghost"}, ${r.at.slice(0, 10)}\n${neutralizeThreadBody(r.body.slice(0, 2500))}\n`;
		if (used + block.length > THREAD_LIMIT) {
			truncated = true;
			break;
		}
		parts.unshift(block);
		used += block.length;
	}
	return {
		text: head + parts.join(""),
		truncated
	};
}
function finish(source, issue, prs, complete, replies, repliesComplete, roster, warnings, note) {
	const isTeam = roster ? teamCheck(roster) : (_, association) => isTeamAssociation(association);
	const openPrAuthors = prs.filter((p) => p.state === "open" && p.author).map((p) => p.author);
	const { body, ...rest } = issue;
	return {
		source,
		issue: rest,
		link: {
			state: linkState(prs, complete),
			prs,
			note
		},
		claim: claimStatus({
			comments: replies,
			isTeam,
			assignees: issue.assignees,
			openPrAuthors
		}),
		discussion: discussionSummary(replies, repliesComplete, isTeam),
		thread: threadText({
			title: issue.title,
			body,
			author: issue.author
		}, replies, isTeam),
		warnings,
		checkedAt: (/* @__PURE__ */ new Date()).toISOString()
	};
}
var COMMENT_PAGES = 3;
/**
* REST lists comments oldest first. For long threads, read the newest pages: recent
* claims and replies matter more than the opening discussion.
*/
async function newestComments(ctx, path, total) {
	if (total === 0) return {
		values: [],
		complete: true
	};
	const pages = Math.ceil(total / 100);
	if (pages <= COMMENT_PAGES) {
		const all = await ctx.client.restAll(path, COMMENT_PAGES);
		return {
			values: all.values,
			complete: all.complete || all.values.length >= total && total % 100 !== 0
		};
	}
	const values = [];
	for (let page = pages - COMMENT_PAGES + 1; page <= pages; page++) values.push(...await ctx.client.rest(`${path}?per_page=100&page=${page}`));
	return {
		values,
		complete: false
	};
}
async function viaRest(ctx, repo, number, roster) {
	await publicRepo(ctx, repo);
	const base = repoPath(repo);
	const warnings = [];
	const issue = await ctx.client.rest(`${base}/issues/${number}`);
	if (issue.pull_request) throw new Error("This number is a pull request, not an issue.");
	let complete;
	const prs = /* @__PURE__ */ new Map();
	try {
		const timeline = await ctx.client.restAll(`${base}/issues/${number}/timeline`);
		complete = timeline.complete;
		for (const e of timeline.values) {
			const src = e.source?.issue;
			if (e.event !== "cross-referenced" || !src?.pull_request || src.repository?.private) continue;
			prs.set(src.html_url, {
				number: src.number,
				title: src.title,
				url: src.html_url,
				state: src.pull_request.merged_at ? "merged" : src.state === "open" ? "open" : "closed",
				draft: Boolean(src.draft),
				author: src.user?.login ?? null,
				repo: src.repository?.full_name ?? repo,
				closing: false
			});
		}
		const connected = /* @__PURE__ */ new Set();
		for (const e of timeline.values) {
			const key = e.source?.issue?.html_url ?? "";
			if (e.event === "connected") connected.add(key);
			else if (e.event === "disconnected") connected.delete(key);
		}
		if (connected.size) warnings.push("A pull request is linked in the Development panel. Sign in to see which one.");
	} catch (error) {
		if (ctx.signal?.aborted) throw error;
		complete = false;
		warnings.push("Timeline references could not be checked.");
	}
	let replies = [];
	let repliesComplete = false;
	try {
		const comments = await newestComments(ctx, `${base}/issues/${number}/comments`, issue.comments);
		replies = comments.values.map(restComment);
		repliesComplete = comments.complete;
	} catch (error) {
		if (ctx.signal?.aborted) throw error;
		warnings.push("Comments could not be loaded; claim detection is incomplete.");
	}
	return finish("rest", {
		number: issue.number,
		title: issue.title,
		url: issue.html_url,
		state: issue.state,
		createdAt: issue.created_at,
		author: issue.user?.login ?? null,
		assignees: (issue.assignees ?? []).map((a) => a.login),
		labels: issue.labels.map((l) => typeof l === "string" ? l : l.name),
		comments: issue.comments,
		body: issue.body ?? ""
	}, [...prs.values()], complete, replies, repliesComplete, roster, warnings, complete ? "Public timeline references checked. A reference may be unrelated, and unlinked work can exist." : "Timeline references could not be checked completely.");
}
var PR_FIELDS = "number title url state isDraft merged author { login } repository { nameWithOwner isPrivate }";
var INSIGHT_QUERY = `
query Insight($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    isPrivate
    issue(number: $number) {
      number title url state createdAt body
      author { login }
      assignees(first: 10) { nodes { login } }
      labels(first: 10) { nodes { name } }
      closedByPullRequestsReferences(first: 10, includeClosedPrs: true) { nodes { ${PR_FIELDS} } }
      timelineItems(itemTypes: [CROSS_REFERENCED_EVENT], last: 50) {
        totalCount
        nodes { ... on CrossReferencedEvent { source { ... on PullRequest { ${PR_FIELDS} } } } }
      }
      comments(last: 100) { totalCount nodes { ${COMMENT_FIELDS} body } }
    }
  }
}`;
var fromGql = (p, closing) => ({
	number: p.number,
	title: p.title,
	url: p.url,
	state: p.merged ? "merged" : p.state === "OPEN" ? "open" : "closed",
	draft: p.isDraft,
	author: p.author?.login ?? null,
	repo: p.repository.nameWithOwner,
	closing
});
/** Development-panel and closing-keyword PRs first (they are fixes), then timeline mentions. */
function linkedFromGql(issue) {
	const prs = /* @__PURE__ */ new Map();
	for (const p of issue.closedByPullRequestsReferences.nodes) if (!p.repository.isPrivate) prs.set(p.url, fromGql(p, true));
	for (const n of issue.timelineItems.nodes) {
		const p = n.source;
		if (p?.url && !p.repository.isPrivate && !prs.has(p.url)) prs.set(p.url, fromGql(p, false));
	}
	return {
		prs: [...prs.values()],
		complete: issue.timelineItems.totalCount <= issue.timelineItems.nodes.length
	};
}
async function viaGraphql(ctx, repo, number, roster) {
	await publicRepo(ctx, repo);
	const { data, errors } = await ctx.client.graphql(INSIGHT_QUERY, {
		...splitRepo(repo),
		number
	});
	const r = data.repository;
	if (!r || r.isPrivate) throw new Error("Only public repositories are supported.");
	const issue = r.issue;
	if (!issue) throw new Error("Issue not found. It may be a pull request or deleted.");
	const { prs, complete } = linkedFromGql(issue);
	return finish("graphql", {
		number: issue.number,
		title: issue.title,
		url: issue.url,
		state: issue.state.toLowerCase(),
		createdAt: issue.createdAt,
		author: issue.author?.login ?? null,
		assignees: issue.assignees.nodes.map((a) => a.login),
		labels: issue.labels.nodes.map((l) => l.name),
		comments: issue.comments.totalCount,
		body: issue.body ?? ""
	}, prs, complete, issue.comments.nodes.map(gqlComment), issue.comments.totalCount <= issue.comments.nodes.length, roster, errors.map((e) => `Partial data from GitHub: ${e}`), complete ? "Development links, closing keywords and timeline references checked. Unlinked work can still exist." : "Over 50 timeline references; only the latest 50 were checked.");
}
var insight = (ctx, repo, number, roster) => preferGraphql(ctx, () => viaGraphql(ctx, repo, number, roster), () => viaRest(ctx, repo, number, roster));
`${PR_FIELDS}${PR_FIELDS}${COMMENT_FIELDS}`;
// src/background/reports/issues.ts
function issueSearchQuery(input) {
	const label = input.label === "beginner" ? "label:\"good first issue\",\"help wanted\"" : input.label ? `label:"${input.label}"` : "";
	const words = input.query.replace(/[^\p{L}\p{N} _-]/gu, " ").trim().slice(0, 100);
	return [
		"repo:" + input.repo,
		"is:issue",
		"is:open",
		label,
		input.unassigned ? "no:assignee" : "",
		words
	].filter(Boolean).join(" ");
}
var LINKS_FRAGMENT = `
  closedByPullRequestsReferences(first: 5) { nodes { state url repository { isPrivate } } }
  timelineItems(itemTypes: [CROSS_REFERENCED_EVENT], last: 20) {
    nodes { ... on CrossReferencedEvent { source { ... on PullRequest { state url repository { isPrivate } } } } }
  }`;
/** One GraphQL request tells us, for a whole page of issues, whether an open PR already exists. */
async function bulkLinks(ctx, repo, numbers) {
	const fields = numbers.map((n) => `i${n}: issue(number: ${n}) { ${LINKS_FRAGMENT} }`).join("\n");
	const { data } = await ctx.client.graphql(`query Links($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`, splitRepo(repo));
	const out = /* @__PURE__ */ new Map();
	for (const n of numbers) {
		const node = data.repository?.[`i${n}`];
		if (!node) continue;
		const open = /* @__PURE__ */ new Set();
		for (const p of node.closedByPullRequestsReferences.nodes) if (p.state === "OPEN" && !p.repository.isPrivate) open.add(p.url);
		for (const t of node.timelineItems.nodes) if (t.source?.state === "OPEN" && t.source.url && !t.source.repository?.isPrivate) open.add(t.source.url);
		out.set(n, open.size);
	}
	return out;
}
async function searchIssues(ctx, input) {
	if (!(await publicRepo(ctx, input.repo)).hasIssues) return {
		items: [],
		total: 0,
		incomplete: false,
		hasNext: false,
		linkCheck: "per-issue",
		warnings: ["Issues are disabled for this repository."]
	};
	const q = issueSearchQuery(input);
	const result = await ctx.client.rest(`/search/issues?q=${encodeURIComponent(q)}&sort=${input.sort}&order=desc&per_page=30&page=${input.page}`);
	const warnings = [];
	const rows = result.items.filter((i) => !i.pull_request && !i.locked);
	const links = ctx.authed && rows.length ? await optional(ctx, warnings, "Bulk pull request check", () => bulkLinks(ctx, input.repo, rows.map((r) => r.number))) : null;
	return {
		items: rows.map((i) => ({
			number: i.number,
			title: i.title,
			url: i.html_url,
			createdAt: i.created_at,
			updatedAt: i.updated_at,
			labels: i.labels.map((l) => l.name),
			assignees: (i.assignees ?? []).map((a) => a.login),
			comments: i.comments,
			author: i.user?.login ?? null,
			linkedOpen: links?.get(i.number) ?? null
		})),
		total: result.total_count,
		incomplete: result.incomplete_results,
		hasNext: hasNextIssuePage(result.items.length, result.total_count, input.page),
		linkCheck: links ? "bulk" : "per-issue",
		warnings
	};
}
// action/src/findings.ts
/**
* What the action says, decided from the same issue report the extension shows.
* Pure functions: no network, no environment. `index.ts` does the reading and posting.
*/
var DUPLICATE_MARKER = "<!-- contri:duplicate-work -->";
var nudgeMarker = (login) => `<!-- contri:quiet-claim @${login.toLowerCase()} -->`;
var FOOTER = "<sub>Posted automatically by [CONTRI](https://github.com/alphasafal/contri) from public comments, assignees and linked pull requests. It can be wrong: the thread has the last word.</sub>";
var same = (a, b) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
var ago = (days) => days <= 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`;
/**
* Is someone else already on this issue? Other people's open pull requests come first,
* then an assignee, then a recent "I'd like to work on this", then a maintainer who said
* the work is theirs. The pull request's own author never counts against it, and a claim
* that went quiet is not a reason to stop anyone.
*/
function duplicateWork(report, pr, repo) {
	const issue = report.issue.number;
	if (report.issue.state.toLowerCase() !== "open") return [];
	const others = report.link.prs.filter((p) => p.state === "open" && same(p.repo, repo) && p.number !== pr.number && !same(p.author, pr.author));
	if (others.length) {
		const first = others[0];
		return [{
			issue,
			kind: "open-pr",
			text: `#${issue} already has an open pull request: #${first.number}${first.author ? ` by @${first.author}` : ""}${others.length > 1 ? ` (and ${others.length - 1} more)` : ""}.`
		}];
	}
	const assignees = report.issue.assignees;
	if (assignees.length && !assignees.some((a) => same(a, pr.author))) return [{
		issue,
		kind: "assigned",
		text: `#${issue} is assigned to ${assignees.map((a) => `@${a}`).join(", ")}.`
	}];
	const { claim } = report;
	if (claim.state === "claimed" && claim.claim && !same(claim.claim.login, pr.author)) return [{
		issue,
		kind: "claimed",
		text: `@${claim.claim.login} [offered to work on #${issue}](${claim.claim.url}) ${ago(claim.ageDays ?? 0)}.`
	}];
	if (claim.team?.fresh && !same(claim.team.claim.login, pr.author)) return [{
		issue,
		kind: "team",
		text: `@${claim.team.claim.login} from the project team [said they are working on #${issue}](${claim.team.claim.url}) ${ago(claim.team.ageDays)}.`
	}];
	return [];
}
/** The comment for a pull request whose issue looks taken. Friendly: the author may simply not have seen it. */
function duplicateComment(author, findings) {
	return [
		DUPLICATE_MARKER,
		`Thanks for the pull request, @${author}! A heads-up before anyone spends more time on it:`,
		"",
		...findings.map((f) => `- ${f.text}`),
		"",
		"This may be fine — plans change and work gets handed over. If you have not already, a quick note in the issue to coordinate saves everyone a duplicate review.",
		"",
		FOOTER
	].join("\n");
}
/**
* A claim that went quiet: someone offered to work on an unassigned issue, at least
* `staleDays` ago (never fewer than the extension's own limit), with no open pull request
* and nothing from them since.
*/
function quietClaim(report, staleDays) {
	const { claim, issue } = report;
	if (issue.state.toLowerCase() !== "open" || claim.state !== "stale" || !claim.claim) return null;
	const age = claim.ageDays ?? 0;
	if (age < Math.max(staleDays, 22)) return null;
	return {
		issue: issue.number,
		login: claim.claim.login,
		ageDays: age,
		claimUrl: claim.claim.url
	};
}
function nudgeComment(nudge) {
	return [
		nudgeMarker(nudge.login),
		`@${nudge.login}, are you still working on this? You [offered](${nudge.claimUrl}) ${ago(nudge.ageDays)} and there is no linked pull request yet.`,
		"",
		"No pressure either way. If you have moved on, just say so and someone else can pick it up; if you are stuck, this is a good place to ask.",
		"",
		FOOTER
	].join("\n");
}
var CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b\s*:?\s+(?:([\w.-]+\/[\w.-]+))?#(\d{1,9})\b/gi;
/** Issue numbers a pull request says it closes ("Fixes #12"), in this repository only. */
function closingNumbers(text, repo) {
	const found = /* @__PURE__ */ new Set();
	for (const m of text.matchAll(CLOSING)) {
		if (m[1] && m[1].toLowerCase() !== repo.toLowerCase()) continue;
		const n = Number(m[2]);
		if (n > 0) found.add(n);
	}
	return [...found];
}
// action/src/run.ts
/** Same rule as @actions/core: `stale-days` arrives as INPUT_STALE-DAYS. */
var input = (env, name, fallback = "") => (env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] ?? "").trim() || fallback;
var flag = (env, name, fallback) => {
	const value = input(env, name).toLowerCase();
	return value ? value === "true" : fallback;
};
var count = (env, name, fallback, max) => {
	const raw = input(env, name);
	const value = Number(raw);
	return raw && Number.isInteger(value) && value >= 0 ? Math.min(value, max) : fallback;
};
var MAX_ISSUES_PER_PR = 5;
var MAX_ISSUES_PER_RUN = 30;
async function run(env, base = (url, init) => fetch(url, init)) {
	const notes = [];
	const repo = parseRepo(env.GITHUB_REPOSITORY ?? "");
	if (!repo) throw new Error("GITHUB_REPOSITORY is not set to owner/name.");
	const token = input(env, "github-token") || env.GITHUB_TOKEN || "";
	if (!token) throw new Error("No token. Pass github-token: ${{ github.token }} (it is the default in action.yml).");
	const dryRun = flag(env, "dry-run", false);
	const apiBase = (env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
	const send = (url, init = {}) => {
		const target = url.startsWith("https://api.github.com") ? apiBase + url.slice(API.length) : url;
		if (!target.startsWith(`${apiBase}/`)) throw new Error("CONTRI only talks to the GitHub API.");
		const headers = new Headers(init.headers);
		headers.set("User-Agent", "contri-action");
		headers.set("Authorization", `Bearer ${token}`);
		return base(target, {
			...init,
			headers
		});
	};
	clearMemory();
	setTransport(send);
	const write = async (method, path, body) => {
		const response = await send(`${API}${path}`, {
			method,
			headers: {
				Accept: "application/vnd.github+json",
				"Content-Type": "application/json"
			},
			body: JSON.stringify(body)
		});
		if (!response.ok) {
			const detail = (await response.json().catch(() => ({}))).message ?? "";
			throw new Error(`GitHub answered ${response.status} for ${method} ${path}${detail ? `: ${detail}` : ""}. The workflow needs "issues: write" and "pull-requests: write" permissions.`);
		}
		return response;
	};
	const comments = async (number) => {
		return (await createCtx(true).client.restAll(`/repos/${repo}/issues/${number}/comments`, 3)).values;
	};
	const event = env.GITHUB_EVENT_NAME ?? "";
	const payload = env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8")) : {};
	if (event === "pull_request" || event === "pull_request_target") {
		const pr = payload.pull_request;
		if (!pr?.user) return {
			mode: "skipped",
			findings: [],
			nudged: [],
			notes: ["No pull request in the event."]
		};
		const author = pr.user.login;
		if (pr.user.type === "Bot" || /\[bot\]$/i.test(author)) return {
			mode: "skipped",
			findings: [],
			nudged: [],
			notes: [`@${author} is a bot.`]
		};
		if (flag(env, "skip-team", true) && isTeamAssociation(pr.author_association)) return {
			mode: "skipped",
			findings: [],
			nudged: [],
			notes: [`@${author} is on the project team.`]
		};
		const numbers = new Set(closingNumbers(pr.body ?? "", repo));
		try {
			const [owner, name] = repo.split("/");
			const { data } = await createCtx(true).client.graphql(`query Closing($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { closingIssuesReferences(first: 10) { nodes { number repository { nameWithOwner } } } } } }`, {
				owner,
				name,
				number: pr.number
			});
			for (const node of data.repository?.pullRequest?.closingIssuesReferences.nodes ?? []) if (node.repository.nameWithOwner.toLowerCase() === repo.toLowerCase()) numbers.add(node.number);
		} catch (error) {
			notes.push(`Linked issues could not be read from GitHub (${error.message}); used the description only.`);
		}
		if (!numbers.size) return {
			mode: "pull-request",
			findings: [],
			nudged: [],
			notes: [...notes, "The pull request closes no issue."]
		};
		const findings = [];
		for (const number of [...numbers].slice(0, MAX_ISSUES_PER_PR)) try {
			const report = await insight(createCtx(true), repo, number);
			findings.push(...duplicateWork(report, {
				number: pr.number,
				author
			}, repo));
		} catch (error) {
			if (!(error instanceof GitHubError) || error.status !== 404) notes.push(`#${number}: ${error.message}`);
		}
		if (!findings.length) return {
			mode: "pull-request",
			findings,
			nudged: [],
			notes: [...notes, "Nobody else is on it."]
		};
		const body = duplicateComment(author, findings);
		if (dryRun) notes.push(`Dry run. Would comment on #${pr.number}:\n${body}`);
		else {
			const existing = (await comments(pr.number)).find((c) => c.body?.includes(DUPLICATE_MARKER));
			if (existing && existing.body === body) notes.push("The comment is already there.");
			else if (existing) await write("PATCH", `/repos/${repo}/issues/comments/${existing.id}`, { body });
			else await write("POST", `/repos/${repo}/issues/${pr.number}/comments`, { body });
			const label = input(env, "label");
			if (label) await write("POST", `/repos/${repo}/issues/${pr.number}/labels`, { labels: [label] });
		}
		return {
			mode: "pull-request",
			findings,
			nudged: [],
			notes
		};
	}
	if (event === "schedule" || event === "workflow_dispatch") {
		const staleDays = count(env, "stale-days", 30, 3650);
		const limit = count(env, "max-nudges", 5, 20);
		const nudged = [];
		if (!limit) return {
			mode: "quiet-claims",
			findings: [],
			nudged,
			notes: ["max-nudges is 0."]
		};
		const list = await searchIssues(createCtx(true), {
			repo,
			label: "beginner",
			query: "",
			unassigned: true,
			sort: "updated",
			page: 1
		});
		for (const item of list.items.slice(0, MAX_ISSUES_PER_RUN)) {
			if (nudged.length >= limit) break;
			if (!item.comments) continue;
			let nudge;
			try {
				nudge = quietClaim(await insight(createCtx(true), repo, item.number), staleDays);
			} catch (error) {
				notes.push(`#${item.number}: ${error.message}`);
				continue;
			}
			if (!nudge) continue;
			const marker = nudgeMarker(nudge.login);
			if ((await comments(item.number)).some((c) => c.body?.includes(marker))) continue;
			const body = nudgeComment(nudge);
			if (dryRun) notes.push(`Dry run. Would comment on #${item.number}:\n${body}`);
			else await write("POST", `/repos/${repo}/issues/${item.number}/comments`, { body });
			nudged.push(item.number);
		}
		if (!nudged.length) notes.push("No claim has gone quiet.");
		return {
			mode: "quiet-claims",
			findings: [],
			nudged,
			notes
		};
	}
	return {
		mode: "skipped",
		findings: [],
		nudged: [],
		notes: [`Nothing to do for the "${event}" event.`]
	};
}
/** Writes the result where GitHub Actions shows it: the log, the step summary and the outputs. */
function report(result, env) {
	for (const note of result.notes) console.log(note);
	const lines = result.mode === "pull-request" ? result.findings.length ? ["**CONTRI: this issue may already be taken**", ...result.findings.map((f) => `- ${f.text}`)] : ["**CONTRI:** nobody else appears to be working on the linked issue."] : result.mode === "quiet-claims" ? [`**CONTRI:** ${result.nudged.length ? `asked about quiet claims on ${result.nudged.map((n) => `#${n}`).join(", ")}.` : "no claim has gone quiet."}`] : [`**CONTRI:** skipped. ${result.notes.join(" ")}`];
	if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
	if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `findings=${result.findings.length}\nnudged=${result.nudged.length}\n`);
}
// action/src/index.ts
run(process.env).then((result) => report(result, process.env)).catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.log(`::${process.env["INPUT_FAIL-ON-ERROR"] === "true" ? "error" : "warning"}::CONTRI could not finish: ${message}`);
	process.exitCode = process.env["INPUT_FAIL-ON-ERROR"] === "true" ? 1 : 0;
});
export {};
