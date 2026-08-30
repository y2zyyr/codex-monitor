# Tibo Codex 监控

**[打开在线监控 →](https://tibo.modelyard.dev/zh/)** · [English README](README.md) · [最新动态](https://tibo.modelyard.dev/zh/latest/) · [重置历史](https://tibo.modelyard.dev/zh/reset-history/) · [限额更新](https://tibo.modelyard.dev/zh/rate-limit-updates/)

Tibo Codex 监控是一个非官方社区项目，追踪 [Tibo（@thsottiaux）](https://x.com/thsottiaux) 关于 Codex 使用额度重置、速率限制、ChatGPT Work 用量和订阅政策的公开动态。

网站会把公开信息整理成带时间戳的 Codex 重置历史和限额更新，并为每条事件标注来源与验证状态。项目独立运营，与 OpenAI 没有隶属关系。

## 主要功能

- 中英文双语 Codex 使用额度监控页面
- 中文界面使用北京时间，英文界面使用纽约时间
- 重置计划、重置完成、时间变更和政策变更分类
- 直接 X API 来源与网页索引来源标识
- Cloudflare Workers + D1 自动监控与历史记录
- [在线监控](https://tibo.modelyard.dev/zh/)、[事件 API](https://tibo.modelyard.dev/api/events) 和[健康状态](https://tibo.modelyard.dev/api/health)

## 本地运行

```bash
npm install
cp .dev.vars.example .dev.vars
cp wrangler.example.jsonc wrangler.jsonc
npm run dev
```

示例配置只包含占位符。真实 API Key、Token、机器人凭据和 Cloudflare 配置不应提交到 GitHub；请使用本地 `.dev.vars` 或 Cloudflare Worker Secrets。

更多安全说明请查看 [SECURITY.md](SECURITY.md)。
