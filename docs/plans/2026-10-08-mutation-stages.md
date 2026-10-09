# Mutation Stage Analysis Implementation Plan

**Goal:** Record per-plant phase plans, per-stage observations and first discoveries, including fertilizer evidence, without inventing historical data.

**Architecture:** Keep the existing account-scoped, single-writer JSONL repository. Store independent records, stages, discoveries and fertilizer operations in one atomic transaction log. Existing rows remain readable without backfilling stages. Existing authorization, account-scoped polling and cancellation rules remain in effect.

**Tech Stack:** Node.js, protobuf fixtures, filesystem journal, Vue 3, TypeScript, node:test.

## Tasks
- [x] Extend repository transactions, stage/discovery/operation tables, first-observation deduplication, coverage statistics, exports and clear.
- [x] Snapshot stage configuration at planting. Observe planting, land reads, fertilizer before/after and pre-harvest; preserve unknown/missing/stale evidence.
- [x] Add view tabs, crop/task filters, phase details, first-discovery details, fertilizer evidence and stage coverage statistics.
- [x] Run offline backend/frontend regression tests, lint, type checking and production build. Do not operate real game accounts or restart active tests.

## Semantics
- Stage numbers are one-based and include the final configured harvestable stage.
- Server phase arrays are remaining suffixes, not total phase plans.
- First observed stage/time is not asserted to be the actual mutation occurrence.
- Server phase begin time, local observation time, server mutation time and weather ID are separate nullable fields.
- Unknown or skipped stages never enter the checked-stage denominator.
- Stage totals and names are frozen at planting; inconsistent configuration is flagged.
- All associated rows reference the original increasing planting ID. Clear removes all related tables but retains the ID high-water mark.
- One mutation type has only one first-discovery row per planting. Multiple types can be discovered together or at different stages.
- Harvest results remain independent from accumulated discoveries.
- Seed/task filters scope analysis; pagination does not change statistics.
- Unchanged background polls are coalesced. Observation counts and last-observation timestamps describe persisted snapshots, not every identical network read. Fertilizer operations retain their own timestamps.
- Frozen phase durations are in seconds. Observation timestamps are milliseconds; CSV timestamps are UTC ISO strings.

## Verification
- Backend full suite: 506 passed (`npm --prefix core test`).
- Frontend full suite: 71 passed (`npm --prefix web test`).
- Vue type checking and production build passed (`npm --prefix web run build`).
- Targeted ESLint checks and `git diff --check` passed; existing unrelated icon warnings remain in the build.
- No browser or real-account acceptance operations were performed. Visual layout and real gameplay remain for user acceptance.
- Backend has not been restarted. Restart is required before new planting captures stage history.
