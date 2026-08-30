# Tibo Codex Monitor — Codex Usage Limit Reset & Rate-Limit Tracker

**[Open the live monitor →](https://tibo.modelyard.dev/)** · [中文介绍](README.zh-CN.md) · [中文界面](https://tibo.modelyard.dev/zh/) · [Latest events](https://tibo.modelyard.dev/latest/) · [Reset history](https://tibo.modelyard.dev/reset-history/) · [Rate-limit updates](https://tibo.modelyard.dev/rate-limit-updates/)

Tibo Codex Monitor is an unofficial community dashboard for public updates from [Tibo (@thsottiaux)](https://x.com/thsottiaux) about Codex usage limit resets, rate limits, ChatGPT Work usage, and subscription changes.

It turns those updates into a timestamped reset history and rate-limit tracker. Each event includes its source and verification status, helping visitors distinguish direct X API evidence from indexed reports. It is independent and not affiliated with OpenAI.

## Why this project

Codex reset announcements are often short public posts and can be easy to miss. This project collects the relevant signals in one bilingual monitor without accessing user accounts or changing usage limits.

## What it includes

- Bilingual English and Simplified Chinese Codex monitor pages
- English dates in New York time and Chinese dates in Beijing time
- Codex usage reset history with reset, time-change, and policy-update categories
- Source and verification labels for each event
- Automatic source monitoring with Cloudflare Workers and D1
- Public pages for the [Codex monitor](https://tibo.modelyard.dev/), [events API](https://tibo.modelyard.dev/api/events), and [health status](https://tibo.modelyard.dev/api/health)

## Screenshots

![Codex usage limit reset monitor in English](audit-evidence/production-en.png)

![Codex usage limit reset monitor in Simplified Chinese](audit-evidence/production-zh.png)

## Run locally

```bash
npm install
cp .dev.vars.example .dev.vars
cp wrangler.example.jsonc wrangler.jsonc
npm run dev
```

The example variables and Wrangler configuration are placeholders. Add real credentials only to the local `.dev.vars` file or to Cloudflare Worker secrets; never commit them.

## Verify and deploy

```bash
npm test
npm run lint
npm run build
npm run deploy
```

Deployment requires access to a Cloudflare account and a configured D1 database. The production Wrangler configuration is kept outside the repository; use `wrangler.example.jsonc` as a starting point. Production credentials are kept outside the repository.

## Security

Please do not post API keys, access tokens, bot tokens, database credentials, or private configuration in issues or pull requests. See [SECURITY.md](SECURITY.md) for the reporting policy.

## License

No license has been added yet. Contact the project owner before reusing the source in another product.
