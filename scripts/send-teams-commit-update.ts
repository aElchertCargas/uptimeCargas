#!/usr/bin/env tsx

import "dotenv/config";

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

interface CliOptions {
  webhookUrl?: string;
  note?: string;
  dryRun: boolean;
}

interface TeamsTarget {
  name: string;
  url: string;
}

interface CommitInfo {
  branch: string;
  fullSha: string;
  shortSha: string;
  subject: string;
  body: string;
  author: string;
  committedAt: string;
  dirtyFiles: number;
  syncState: string;
  repoDisplay: string;
  commitUrl: string | null;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TEAMS_WEBHOOK_URL =
  "https://default8b9e7f0432b8436a85bd570914622b.a3.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/001c39aa96b845faaf095f52433fdd6c/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=asaBeO5dkzSBqRCjNa01zjLzwWwVW8kORbs1A-WPEDg";

function runGit(args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { dryRun: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    switch (arg) {
      case "--webhook-url":
        options.webhookUrl = argv[i + 1];
        i += 1;
        break;
      case "--note":
        options.note = argv[i + 1];
        i += 1;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      default:
        if (arg.startsWith("--")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        break;
    }
  }

  return options;
}

function printUsage() {
  console.log(`Send the latest git commit to Teams

Usage:
  npm run teams:commit-update
  npm run teams:commit-update -- --webhook-url "https://..."
  npm run teams:commit-update -- --note "URL audit and inline edit shipped"
  npm run teams:commit-update -- --dry-run

Options:
  --webhook-url <url>    Override the default Teams webhook URL
  --note <text>          Append a short note to the Teams message
  --dry-run              Print the payload instead of posting it

Environment:
  TEAMS_WEBHOOK_URL      Optional webhook override
`);
}

function parseGitHubRepo(remoteUrl: string): { owner: string; repo: string } | null {
  const sshMatch = remoteUrl.match(/^[^:]+:([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return {
      owner: sshMatch[1],
      repo: sshMatch[2],
    };
  }

  try {
    const url = new URL(remoteUrl);
    const [owner, repoWithGit] = url.pathname.replace(/^\/+/, "").split("/");
    if (!owner || !repoWithGit) {
      return null;
    }

    return {
      owner,
      repo: repoWithGit.replace(/\.git$/, ""),
    };
  } catch {
    return null;
  }
}

function getCommitInfo(): CommitInfo {
  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  const fullSha = runGit(["rev-parse", "HEAD"]);
  const shortSha = runGit(["rev-parse", "--short", "HEAD"]);
  const subject = runGit(["log", "-1", "--pretty=%s"]);
  const body = runGit(["log", "-1", "--pretty=%b"]);
  const author = runGit(["log", "-1", "--pretty=%an"]);
  const committedAt = runGit(["log", "-1", "--date=iso", "--pretty=%ad"]);
  const dirtyStatus = runGit(["status", "--porcelain"]);
  const dirtyFiles = dirtyStatus ? dirtyStatus.split("\n").filter(Boolean).length : 0;

  let syncState = "No upstream configured";
  try {
    const counts = runGit(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]);
    const [behindRaw, aheadRaw] = counts.split(/\s+/);
    const behind = Number(behindRaw);
    const ahead = Number(aheadRaw);

    if (ahead === 0 && behind === 0) {
      syncState = "Up to date with upstream";
    } else {
      const parts: string[] = [];
      if (ahead > 0) parts.push(`ahead ${ahead}`);
      if (behind > 0) parts.push(`behind ${behind}`);
      syncState = parts.join(", ");
    }
  } catch {
    // Ignore missing upstream info.
  }

  const remoteUrl = runGit(["remote", "get-url", "origin"]);
  const parsedRepo = parseGitHubRepo(remoteUrl);
  const repoDisplay = parsedRepo ? `${parsedRepo.owner}/${parsedRepo.repo}` : remoteUrl;
  const commitUrl = parsedRepo
    ? `https://github.com/${parsedRepo.owner}/${parsedRepo.repo}/commit/${fullSha}`
    : null;

  return {
    branch,
    fullSha,
    shortSha,
    subject,
    body,
    author,
    committedAt,
    dirtyFiles,
    syncState,
    repoDisplay,
    commitUrl,
  };
}

async function getTeamsTarget(options: CliOptions): Promise<TeamsTarget> {
  return {
    name: "Default Teams webhook",
    url: options.webhookUrl ?? process.env.TEAMS_WEBHOOK_URL ?? DEFAULT_TEAMS_WEBHOOK_URL,
  };
}

function buildTeamsPayload(commit: CommitInfo, note?: string) {
  const facts = [
    { title: "Committed", value: commit.committedAt },
  ];

  const body: Array<Record<string, unknown>> = [
    {
      type: "TextBlock",
      text: "👍",
      horizontalAlignment: "Center",
    },
    {
      type: "TextBlock",
      size: "Medium",
      weight: "Bolder",
      text: "Latest commit update",
    },
    {
      type: "TextBlock",
      text: commit.subject,
      wrap: true,
      spacing: "Small",
    },
    {
      type: "FactSet",
      facts,
    },
  ];

  if (note) {
    body.push({
      type: "TextBlock",
      text: `Note: ${note}`,
      wrap: true,
      spacing: "Medium",
    });
  }

  return {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.4",
    body,
  };
}

async function postToTeams(target: TeamsTarget, payload: unknown) {
  const response = await fetch(target.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    throw new Error(
      `Teams webhook failed: HTTP ${response.status} ${response.statusText}${
        responseText ? ` - ${responseText}` : ""
      }`
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const commit = getCommitInfo();
  const payload = buildTeamsPayload(commit, options.note);

  if (options.dryRun) {
    const channelName = (await getTeamsTarget(options)).name;

    console.log(
      JSON.stringify(
        {
          channel: channelName,
          commit: {
            branch: commit.branch,
            shortSha: commit.shortSha,
            subject: commit.subject,
          },
          payload,
        },
        null,
        2
      )
    );
    return;
  }

  const teamsTarget = await getTeamsTarget(options);
  await postToTeams(teamsTarget, payload);

  console.log(`Posted commit update to Teams channel "${teamsTarget.name}"`);
  console.log(`Commit: ${commit.shortSha} ${commit.subject}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
