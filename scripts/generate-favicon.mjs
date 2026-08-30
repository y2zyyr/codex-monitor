import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const svg = `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <rect width="32" height="32" rx="4" fill="#0a0a0f"/>
  <g transform="translate(3, 3)" fill="none" stroke="#4a8eff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M13 1L1 9l12 8 12-8L13 1z"/>
    <path d="M1 18l12 8 12-8"/>
    <path d="M1 12l12 8 12-8"/>
  </g>
</svg>`;

async function generate() {
  await sharp(Buffer.from(svg)).png().toFile(path.join(__dirname, '..', 'static', 'favicon.ico'));
  console.log('favicon.ico created');
  // Also create a larger apple-touch-icon
  const appleSvg = `<svg width="180" height="180" viewBox="0 0 180 180" xmlns="http://www.w3.org/2000/svg">
    <rect width="180" height="180" rx="24" fill="#0a0a0f"/>
    <g transform="translate(30, 30)" fill="none" stroke="#4a8eff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M60 6L6 54l54 48 54-48L60 6z"/>
      <path d="M6 102l54 48 54-48"/>
      <path d="M6 72l54 48 54-48"/>
    </g>
    <text x="90" y="155" font-family="Inter,sans-serif" font-size="22" font-weight="600" fill="#9090a0" text-anchor="middle">CODEX</text>
  </svg>`;
  await sharp(Buffer.from(appleSvg))
    .resize(180, 180)
    .png()
    .toFile(path.join(__dirname, '..', 'static', 'apple-touch-icon.png'));
  console.log('apple-touch-icon.png created');
}

generate().catch(console.error);
