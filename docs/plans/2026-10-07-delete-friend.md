# 删除好友 Implementation Plan

**Goal:** 在 404 好友列表直接删除游戏好友，不要求二次确认。

**Architecture:** 复用现有 `/api/friend/:gid/delete`、worker 和 `DelFriend` 协议。成功后清理内存和磁盘缓存、移除已知 GID、加入黑名单并广播配置，前端移除好友和土地数据。请求期间禁用对应删除按钮，失败保留数据并提示原因，账号切换和旧请求不能覆盖删除结果。

**Tech Stack:** CommonJS、Vue 3、TypeScript、Pinia、Node.js `node:test`。

---

1. 用固定夹具覆盖删除成功、失败、重复点击、账号切换、旧列表响应，以及页面直接执行且不打开确认框。
2. 在 `core/src/services/friend.js` 和 `core/src/controllers/admin-friend-routes.js` 补齐现有删除接口的缓存与配置同步。
3. 在 `web/src/stores/friend.ts`、`web/src/views/Friends.vue`、`web/src/components/friends/FriendsFriendList.vue` 接入删除、加载反馈、提示及分页修正。
4. 运行聚焦测试、两端完整测试、修改文件 ESLint、前端类型检查和生产构建。按钮布局和真实账号交互由用户人工验收，不使用真实账号测试。

```sh
node --test core/test/friend-delete.test.js
corepack pnpm -C web exec node --test test/friend-delete.test.mjs
corepack pnpm -C core test
corepack pnpm -C web test
corepack pnpm build
```
