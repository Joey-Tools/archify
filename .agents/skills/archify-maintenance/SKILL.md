---
name: archify-maintenance
description: Only when the user explicitly invokes $archify-maintenance, manually fast-forward Joey-Tools/archify/main from tt-a1i/archify/main, review the upstream delta, and create or update the rolling main-to-joey-custom pull request. Do not use for implicit matches, scheduled work, or unconfirmed merges.
---

# Archify Maintenance

## Invocation gate

Use this Skill only when the user explicitly invokes `$archify-maintenance` in the current request. A request to update Archify or synchronize upstream without that exact invocation is not sufficient. If it was not explicitly invoked, stop.

## Scope

This is a manual two-branch maintenance workflow for the Joey-Tools fork:

- `main` mirrors `tt-a1i/archify/main` and accepts only fast-forward updates.
- `joey-custom` is the default branch and contains the reviewed customization.
- The synchronization pull request is `main → joey-custom`.
- No scheduled workflow, force-push, guessed merge, or direct write to `joey-custom` is allowed.

The repository must have merge commits enabled for the synchronization PR. Squash-only settings break the ancestry required by the next rolling update. The Skill must report this as an anomaly and stop; it must not change repository settings.

## Single-session workflow

1. Run the fixed helper from the repository root:

   ```bash
   node .agents/skills/archify-maintenance/scripts/maintain.mjs sync
   ```

2. The helper checks the fork identity, requires a clean worktree, fetches upstream `main` manually, verifies that fork `main` is strictly behind or equal, and pushes only a fast-forward update to fork `main`.
3. Review the helper's bounded report: upstream commits, changed paths, relevant customization touchpoints, and the open or newly created `main → joey-custom` PR.
4. Summarize what changed and ask Joey to confirm the exact PR. Do not merge based on a general acknowledgement or a clean-looking diff.
5. Only after Joey explicitly confirms the PR, run:

   ```bash
   node .agents/skills/archify-maintenance/scripts/maintain.mjs merge --pr <number> --confirm-merge
   ```

   The helper verifies that the PR is still open, has base `joey-custom`, head `main`, and the current fork `main` head. It requires existing required checks to pass and uses a merge commit with a head-match guard. It never bypasses checks or deletes `main`.

## Anomalies

Stop and report any of these for Joey's decision:

- fork `main` is ahead of or diverged from upstream `main`;
- origin or upstream identity is unexpected;
- the worktree is dirty;
- more than one matching open PR exists;
- the PR head changed after review;
- required checks fail, remain pending, or are otherwise unavailable;
- merge commits are disabled, the PR is not mergeable, or GitHub reports an unexpected branch shape.

Do not force-push, resolve conflicts automatically, close or replace a PR, alter branch protection, or merge while an anomaly is unresolved.
