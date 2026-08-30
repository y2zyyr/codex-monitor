# Tibo 信息源增量同步实施报告

实施目标：让 `@thsottiaux` 的新帖尽快进入监控，同时避免把页面访问、重复轮询和网页搜索误计为 X Post 读取。

部署状态（2026-08-27）：已部署到 `tibo.modelyard.dev`，Cloudflare Version ID 为 `3fecf3ae-16e3-4622-b339-8b3d64c7daf8`，Cron 为 `*/15 * * * *`。

## 当前链路

```text
Cloudflare Cron（每 15 分钟，UTC）
  → X API 用户时间线（since_id，排除回复/转发）
  → D1 source_posts（canonical X Post ID 去重）
  → 成功写入后提交账号游标
  → 分类与 monitor_events

网页搜索（正常每 4 小时；直连失败/超过 30 分钟未成功时兜底）
  → INDEXED source_posts
  → 与 DIRECT 记录按 canonical X Post ID 合并
```

页面、RSS、导出和搜索接口只读取 D1，不会触发 X API 或网页搜索。

## 关键安全规则

- `x_api_since_id:{account}` 只在该账号所有已取得帖子成功写入 D1 后推进。
- 分页不完整、D1 写入失败或账号失败时保留当前游标，下一轮允许重复取得并由唯一约束去重。
- D1 锁 `x_api_sync_lock` 与 `provider_usage.last_request_slot` 共同防止 Cron、手动触发和并发 Worker 重复同步。
- X API 429 会保存 `x-rate-limit-remaining` / `x-rate-limit-reset`；剩余为 0 时等待 reset 时间。
- 分类失败只保留 `classification_pending`，不会删除或跳过原始帖子。

## 预算和降级

- X 的 `96/day` 是内部同步尝试安全上限，不代表 X 的 Post read 账单额度；`since_id` 无新帖轮询不应产生新的 Post 读取。
- 网页搜索正常预算为每天 6 次、正常间隔 4 小时。
- 直连异常时兜底退避为 30 分钟、1 小时、2 小时、4 小时，最多每天 6 次。
- Direct 证据优先于 Indexed 证据；不会因为搜索命中再逐条请求 X Post lookup。

## 状态接口和前端

`/api/status` 与 `/api/health` 的 `providers.xApi` 暴露配置、自动同步、状态、轮询间隔、最近尝试/成功/新帖时间、下一次轮询、速率限制剩余量和当天观测帖子数。首页信息源卡片显示 `X Direct` 或 `Web Indexed`，并显示直连异常/最近新帖时间。

## 验证结果

- `npm run lint` 通过。
- `npm run build` 通过（Wrangler dry-run 构建）。
- `npm test`：16 个测试文件、172 个测试全部通过。
- 生产环境已存在 `X_API_BEARER_TOKEN` Secret，且远端 D1 已缓存 `thsottiaux` 的稳定用户 ID。生产配置不会随公开源码发布；部署时不会再因用户名解析额外调用 X API。
