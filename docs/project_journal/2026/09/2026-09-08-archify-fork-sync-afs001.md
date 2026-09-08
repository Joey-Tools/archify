---
id: 20260908-afs001
title: Archify Fork Synchronization and Explicit Invocation
status: active
created: 2026-09-08
updated: 2026-09-08
branch: wip/archify-private-sync
pr:
supersedes: []
superseded_by:
---

# Archify Fork Synchronization and Explicit Invocation

## Summary

- 将 `Joey-Tools/archify` 作为 private install 的外部 source，并以 `joey-custom` 作为默认分支。
- 将 Archify 和维护 workflow 都限制为显式 `$archify` / `$archify-maintenance` 调用。
- 保留 Archify 原生的版本检查，但将 manifest 获取渠道切到 fork 的 `joey-custom`。

## Current State

- `main` 继续作为 upstream `tt-a1i/archify/main` 的镜像，只允许 fast-forward。
- `joey-custom` 通过 PR 接收 `main` 的更新；PR 内容由 agent 报告，合并必须得到 Joey 的明确确认。
- 更新 manifest 使用 fork 默认分支上的 raw 文件；manifest 内仍保留 upstream tag、tree SHA、artifact SHA-256 和 release notes。
- 当前 fork 尚未启用 merge commit；maintenance helper 会在 merge 阶段 fail closed，等待仓库设置调整。

## Decisions

- 采用手动触发，不创建定期 upstream 同步 workflow。
- 未合并时复用 `main → joey-custom` 滚动 PR；合并后继续由下一次手动同步创建或更新。
- 异常由 agent 主动报告并暂停，由 Joey 当场决定。
- 只做 explicit-only 调用和 update manifest 渠道定制，保留 Archify 的其他原生行为。

## Next Steps

- 启用 fork 的 merge commit 设置。
- 完成 Archify 定制 PR 和 private overlay source-lock integration。
- 在 clean checkout 中运行 maintenance helper，验证完整的手动同步和确认后合并流程。

## Evidence

- `archify/SKILL.md`
- `archify/agents/openai.yaml`
- `.agents/skills/archify-maintenance/SKILL.md`
- `.agents/skills/archify-maintenance/scripts/maintain.mjs`
