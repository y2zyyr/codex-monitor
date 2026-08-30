import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const width = 1200;
const height = 630;
const bgColor = { r: 10, g: 10, b: 15 };

const svgText = `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#4a8eff;stop-opacity:0.15" />
      <stop offset="100%" style="stop-color:#22c55e;stop-opacity:0.05" />
    </linearGradient>
    <linearGradient id="line" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#4a8eff;stop-opacity:0.3" />
      <stop offset="50%" style="stop-color:#4a8eff;stop-opacity:0.8" />
      <stop offset="100%" style="stop-color:#4a8eff;stop-opacity:0.3" />
    </linearGradient>
  </defs>

  <rect width="${width}" height="${height}" fill="url(#accent)" />

  <g stroke="#2a2a3a" stroke-width="0.5" opacity="0.3">
    <line x1="0" y1="0" x2="${width}" y2="0" />
    <line x1="0" y1="${Math.round(height*0.333)}" x2="${width}" y2="${Math.round(height*0.333)}" />
    <line x1="0" y1="${Math.round(height*0.667)}" x2="${width}" y2="${Math.round(height*0.667)}" />
    <line x1="0" y1="${height}" x2="${width}" y2="${height}" />
  </g>

  <rect x="80" y="180" width="200" height="4" rx="2" fill="url(#line)" />

  <text x="80" y="240" font-family="'Inter','Helvetica Neue',sans-serif" font-size="52" font-weight="700" fill="#e8e8ed">
    Tibo Codex Monitor
  </text>

  <text x="80" y="300" font-family="'Inter','Helvetica Neue',sans-serif" font-size="28" font-weight="400" fill="#9090a0">
    Codex Reset &amp; Rate Limit Tracker
  </text>

  <text x="80" y="380" font-family="'JetBrains Mono','SF Mono',monospace" font-size="20" fill="#4a8eff" opacity="0.8">
    tibo.modelyard.dev
  </text>

  <text x="80" y="550" font-family="'Inter','Helvetica Neue',sans-serif" font-size="16" fill="#606070">
    Unofficial community monitor
  </text>
</svg>
`;

async function generate() {
  const svgBuffer = Buffer.from(svgText);
  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: bgColor,
    }
  })
    .composite([{ input: svgBuffer, top: 0, left: 0 }])
    .png()
    .toFile(path.join(__dirname, '..', 'static', 'og-default.png'));

  console.log('OG image generated successfully');
}

generate().catch(console.error);
