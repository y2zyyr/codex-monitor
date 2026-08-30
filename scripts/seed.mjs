// ============================================================
// Codex Usage Monitor - Seed Script
// ============================================================
// Run: node scripts/seed.mjs
// Prerequisites: D1 database must exist, wrangler configured
//
// This script imports historical events from a JSON file.
// Usage: node scripts/seed.mjs <path-to-json>
//
// JSON format:
// {
//   "events": [
//     {
//       "source": "x",
//       "source_account": "thsottiaux",
//       "source_post_id": "123456789",
//       "source_url": "https://x.com/thsottiaux/status/...",
//       "text": "Original post text",
//       "published_at": "2026-08-25T00:00:00.000Z",
//       "category": "POLICY_CHANGE",
//       "title_en": "Short title",
//       "title_zh": "中文标题",
//       "summary_en": "Summary",
//       "summary_zh": "摘要",
//       "confidence": 0.95,
//       "effective_at": null,
//       "reset_at": null
//     }
//   ]
// }
//
// IMPORTANT: Do not fabricate data. Only seed events with
// verified source posts and accurate timestamps.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node scripts/seed.mjs <path-to-json>');
    console.error('Provide a JSON file with verified historical events.');
    process.exit(1);
  }

  let data;
  try {
    const content = readFileSync(filePath, 'utf-8');
    data = JSON.parse(content);
  } catch (err) {
    console.error('Failed to read/parse JSON file:', err.message);
    process.exit(1);
  }

  if (!data.events || !Array.isArray(data.events) || data.events.length === 0) {
    console.error('JSON must contain an "events" array with at least one event.');
    process.exit(1);
  }

  console.log(`Found ${data.events.length} events to seed.`);
  console.log('NOTE: This script requires the D1 database to be accessible.');
  console.log('Use: wrangler d1 execute codex-monitor-db --remote --file=./migrations/0001_initial.sql');
  console.log('Then manually insert events via the D1 console or API.');
  console.log('');
  console.log('To seed via API, send POST requests to /api/admin/seed (if implemented).');
  console.log('Otherwise, use the Cloudflare Dashboard D1 console to insert data.');
  console.log('');
  console.log('Example SQL for one event:');
  console.log('');
  console.log('-- Insert source post:');
  console.log('INSERT INTO source_posts (source, source_account, source_post_id, source_url, text, published_at, fetched_at, raw_json, content_hash)');
  console.log('VALUES (\'x\', \'thsottiaux\', \'POST_ID\', \'URL\', \'Post text\', \'2026-08-25T00:00:00.000Z\', datetime(\'now\'), \'{}\', \'HASH\');');
  console.log('');
  console.log('-- Insert monitor event:');
  console.log('INSERT INTO monitor_events (source_post_id, category, title_en, title_zh, summary_en, summary_zh, confidence, published_at, source_url)');
  console.log('VALUES (1, \'POLICY_CHANGE\', \'Title\', \'标题\', \'Summary\', \'摘要\', 0.95, \'2026-08-25T00:00:00.000Z\', \'URL\');');

  // Print individual events for manual insertion
  for (const event of data.events) {
    console.log('\n--- Event ---');
    console.log(`Source: ${event.source_url}`);
    console.log(`Category: ${event.category}`);
    console.log(`Title: ${event.title_en}`);
    console.log(`Published: ${event.published_at}`);
  }
}

main().catch(console.error);
