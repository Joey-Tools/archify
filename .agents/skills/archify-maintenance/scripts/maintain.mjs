#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const FORK_REPOSITORY = 'Joey-Tools/archify';
const FORK_ORIGIN = 'git@github.com:Joey-Tools/archify.git';
const UPSTREAM_REPOSITORY = 'tt-a1i/archify';
const UPSTREAM_URL = 'https://github.com/tt-a1i/archify.git';
const SOURCE_BRANCH = 'main';
const CUSTOM_BRANCH = 'joey-custom';
const SYNC_TITLE = '[archify] Sync upstream main into joey-custom';
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_CHANGED_PATHS = 300;

function usage() {
  return `Usage:
  node .agents/skills/archify-maintenance/scripts/maintain.mjs sync
  node .agents/skills/archify-maintenance/scripts/maintain.mjs merge --pr <number> --confirm-merge
`;
}

function fail(message) {
  throw new Error(message);
}

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT_BYTES,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_NO_LAZY_FETCH: '1',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_TERMINAL_PROMPT: '0',
    },
  });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0 && !allowFailure) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`${command} ${args.join(' ')} failed (${result.status}): ${detail || 'no detail'}`);
  }
  return result;
}

function git(...args) {
  const options = args.at(-1);
  if (options && typeof options === 'object' && !Array.isArray(options)) {
    return run('git', args.slice(0, -1), options);
  }
  return run('git', args);
}

function gitOutput(...args) {
  return git(...args).stdout.trim();
}

function gh(...args) {
  return run('gh', args);
}

function ghJson(...args) {
  const output = gh(...args).stdout.trim();
  try {
    return JSON.parse(output || 'null');
  } catch (error) {
    throw new Error(`gh returned invalid JSON: ${error.message}`);
  }
}

function repositoryRoot() {
  return gitOutput('rev-parse', '--show-toplevel');
}

function normalizeRemote(value) {
  return value.trim()
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
}

function assertRepository() {
  const root = repositoryRoot();
  const origin = gitOutput('remote', 'get-url', 'origin');
  if (normalizeRemote(origin) !== normalizeRemote(FORK_ORIGIN)) {
    fail(`origin is ${origin}, expected ${FORK_ORIGIN}`);
  }
  const status = gitOutput('status', '--porcelain', '--untracked-files=all');
  if (status) fail('worktree is dirty; commit or remove local changes before maintenance');
  return root;
}

function remoteSha(ref) {
  const result = git('ls-remote', 'origin', `refs/heads/${ref}`);
  const line = result.stdout.trim();
  if (!line) fail(`origin branch ${ref} does not exist`);
  const [sha, returnedRef] = line.split(/\s+/);
  if (returnedRef !== `refs/heads/${ref}` || !/^[0-9a-f]{40}$/.test(sha)) {
    fail(`origin branch ${ref} returned an invalid ref result`);
  }
  return sha;
}

function isAncestor(ancestor, descendant) {
  return git('merge-base', '--is-ancestor', ancestor, descendant, { allowFailure: true }).status === 0;
}

function boundedLines(value, limit = MAX_CHANGED_PATHS) {
  const lines = value.split('\n').filter(Boolean);
  return {
    lines: lines.slice(0, limit),
    truncated: lines.length > limit,
  };
}

function diffReport(from, to) {
  const stat = gitOutput('diff', '--stat', '--find-renames', `${from}..${to}`);
  const paths = boundedLines(gitOutput('diff', '--name-status', '--find-renames', `${from}..${to}`));
  return { stat, paths: paths.lines, pathsTruncated: paths.truncated };
}

function writeBody(report) {
  const body = [
    '## Summary',
    '',
    `Synchronizes fork \`${SOURCE_BRANCH}\` from \`${UPSTREAM_REPOSITORY}/${SOURCE_BRANCH}\` for review into \`${CUSTOM_BRANCH}\`.`,
    '',
    `- Upstream head: \`${report.upstreamHead}\``,
    `- Fork main before: \`${report.forkMainBefore}\``,
    `- Fork main after: \`${report.forkMainAfter}\``,
    '- Main update policy: fast-forward only.',
    '- Merge policy: merge commit after explicit human confirmation.',
    '',
    '## Upstream delta',
    '',
    '```text',
    report.delta.stat || 'No file changes.',
    '```',
    '',
    'The maintainer must review the changed paths and explicitly confirm the PR before merging.',
    '',
  ].join('\n');
  const bodyPath = path.join(os.tmpdir(), `archify-maintenance-${process.pid}.md`);
  fs.writeFileSync(bodyPath, body, { encoding: 'utf8', mode: 0o600 });
  return { bodyPath, body };
}

function matchingPullRequests() {
  return ghJson(
    'pr', 'list',
    '--repo', FORK_REPOSITORY,
    '--state', 'open',
    '--base', CUSTOM_BRANCH,
    '--head', `${FORK_REPOSITORY.split('/')[0]}:${SOURCE_BRANCH}`,
    '--limit', '10',
    '--json', 'number,url,title,baseRefName,headRefName,headRefOid',
  );
}

function sync() {
  assertRepository();
  git('fetch', '--no-tags', 'origin', SOURCE_BRANCH);
  git('fetch', '--no-tags', UPSTREAM_URL, SOURCE_BRANCH);

  const forkMainBefore = gitOutput('rev-parse', 'refs/remotes/origin/main');
  const upstreamHead = gitOutput('rev-parse', 'FETCH_HEAD');
  if (forkMainBefore !== upstreamHead && !isAncestor(forkMainBefore, upstreamHead)) {
    fail(`fork main ${forkMainBefore} is not an ancestor of upstream main ${upstreamHead}`);
  }

  const delta = diffReport(forkMainBefore, upstreamHead);
  if (forkMainBefore !== upstreamHead) {
    git('push', 'origin', `${upstreamHead}:refs/heads/main`);
  }
  const forkMainAfter = remoteSha(SOURCE_BRANCH);
  if (forkMainAfter !== upstreamHead) fail('fork main changed unexpectedly after the fast-forward push');

  git('fetch', '--no-tags', 'origin', CUSTOM_BRANCH);
  const pullRequests = matchingPullRequests();
  if (pullRequests.length > 1) fail(`found ${pullRequests.length} matching open synchronization PRs`);

  let pullRequest = pullRequests[0] || null;
  let bodyPath;
  if (forkMainBefore !== upstreamHead) {
    ({ bodyPath } = writeBody({
      upstreamHead,
      forkMainBefore,
      forkMainAfter,
      delta,
    }));
    try {
      if (pullRequest) {
        gh('pr', 'edit', String(pullRequest.number), '--repo', FORK_REPOSITORY, '--title', SYNC_TITLE, '--body-file', bodyPath);
      } else {
        const created = gh('pr', 'create', '--repo', FORK_REPOSITORY, '--base', CUSTOM_BRANCH, '--head', SOURCE_BRANCH, '--title', SYNC_TITLE, '--body-file', bodyPath);
        pullRequest = { number: Number(created.stdout.trim().match(/\/pull\/(\d+)/)?.[1] || 0), url: created.stdout.trim() };
      }
    } finally {
      fs.rmSync(bodyPath, { force: true });
    }
  } else if (pullRequest) {
    fail(`matching open PR ${pullRequest.number} exists but upstream main has no new commit; inspect it manually`);
  }

  console.log(JSON.stringify({
    ok: true,
    command: 'sync',
    forkRepository: FORK_REPOSITORY,
    upstreamRepository: UPSTREAM_REPOSITORY,
    forkMainBefore,
    forkMainAfter,
    upstreamHead,
    updatedMain: forkMainBefore !== upstreamHead,
    delta,
    pullRequest,
    nextAction: pullRequest ? `Review PR #${pullRequest.number} and obtain explicit confirmation before merge.` : 'No upstream update and no synchronization PR required.',
  }, null, 2));
}

function merge(prNumber) {
  assertRepository();
  const settings = ghJson('api', `repos/${FORK_REPOSITORY}`);
  if (settings.allow_merge_commit !== true) {
    fail('merge commits are disabled for the fork; enable them before merging the synchronization PR');
  }
  const pr = ghJson('pr', 'view', String(prNumber), '--repo', FORK_REPOSITORY, '--json', 'number,url,state,baseRefName,headRefName,headRefOid,mergeStateStatus');
  if (pr.state !== 'OPEN' || pr.baseRefName !== CUSTOM_BRANCH || pr.headRefName !== SOURCE_BRANCH) {
    fail(`unexpected PR shape or state: ${JSON.stringify(pr)}`);
  }
  const currentMain = remoteSha(SOURCE_BRANCH);
  if (pr.headRefOid !== currentMain) fail(`PR head ${pr.headRefOid} does not match current fork main ${currentMain}`);

  const checksResult = run('gh', ['pr', 'checks', String(prNumber), '--repo', FORK_REPOSITORY, '--required', '--json', 'bucket,name,state'], { allowFailure: true });
  let checks = [];
  try {
    checks = JSON.parse((checksResult.stdout || '[]').trim() || '[]');
  } catch (error) {
    fail(`required check response was not valid JSON: ${error.message}`);
  }
  const nonPassing = checks.filter((check) => check.bucket !== 'pass');
  if (checksResult.status !== 0 || nonPassing.length) {
    fail(`required checks are not all passing: ${JSON.stringify(nonPassing.length ? nonPassing : checks)}`);
  }

  gh('pr', 'merge', String(prNumber), '--repo', FORK_REPOSITORY, '--merge', '--match-head-commit', currentMain);
  console.log(JSON.stringify({ ok: true, command: 'merge', pr: prNumber, mergeMethod: 'merge', head: currentMain }, null, 2));
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--help' || command === undefined) {
    console.log(usage());
    return;
  }
  if (command === 'sync' && args.length === 0) {
    sync();
    return;
  }
  if (command === 'merge') {
    const prIndex = args.indexOf('--pr');
    const prNumber = prIndex >= 0 ? args[prIndex + 1] : null;
    if (!/^\d+$/.test(prNumber || '') || !args.includes('--confirm-merge')) {
      fail('merge requires --pr <number> --confirm-merge');
    }
    merge(prNumber);
    return;
  }
  fail(`unknown arguments\n\n${usage()}`);
}

try {
  main();
} catch (error) {
  console.error(`maintenance error: ${error.message}`);
  process.exitCode = 1;
}
