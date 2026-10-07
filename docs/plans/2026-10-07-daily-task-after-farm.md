# 种植收获后巡查日常任务 Implementation Plan

**Goal:** 在账号设置的“日常与活动”中增加默认关闭的开关，每轮自动种植收获正常结束后触发一次现有日常任务流程。

**Architecture:** 使用 `automation.task_after_farm` 保存账号开关。`checkFarm` 完成整轮操作并释放巡田标记后发出完成事件；日常任务定时器的生命周期统一注册和移除监听。调用 `runDailyRoutines(false)`，保留各服务的每日完成状态、冷却和自动领取开关，并防止日常流程重叠。

**Tech Stack:** CommonJS JavaScript、Vue 3、TypeScript、Node.js `node:test`。

---

## 设计边界

- 定时和土地推送触发的自动巡田均覆盖；即便本轮没有成熟或空地，也正常触发一次。
- 未登录、自动巡田关闭、巡田已在执行、获取土地失败时不触发。
- 手工操作不改变日常任务触发行为；活动自身的五分钟定时器不改动。
- 原有登录、推送、跨日触发保留。此开关只增加巡田完成后的触发来源，不绕过日常任务开关或冷却。
- 停止或重连不得遗留、重复注册事件监听；日常流程正在执行时合并触发，失败后允许后续重试。

## 实现步骤

1. 在 `core/test/daily-task-after-farm.test.js` 增加固定夹具测试，覆盖开关默认值和保存、完成时序、错误与并发、定时/推送巡田、重连与清理。先运行验证新增场景失败。
2. 修改 `core/src/models/store.js`、`core/src/services/farming-orchestrator.js`、`core/src/core/worker.js`，接入配置和日常流程完成事件。
3. 修改 `web/src/composables/settings/useAutomationSettings.ts`、`web/src/components/settings/AccountFeatureSettings.vue`、`web/src/components/settings/AutomationSettingsTab.vue`，在新旧设置界面接入同一开关；模块关闭时关闭此开关。
4. 运行聚焦测试、后端和前端测试、修改文件的 ESLint、前端类型检查及生产构建。布局和实际账号操作由用户人工验收。

## 验证命令

```sh
node --test core/test/daily-task-after-farm.test.js
corepack pnpm -C core test
corepack pnpm -C web test
corepack pnpm build
```
