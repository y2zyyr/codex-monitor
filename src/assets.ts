// Keep public static assets cacheable without sacrificing deploy safety.
// Bump this value whenever a browser-served asset changes. The versioned URL
// lets the worker safely advertise immutable caching for that exact payload.
export const STATIC_ASSET_VERSION = '20260904-p0';

export function staticAssetUrl(fileName: string): string {
  const normalized = fileName.replace(/^\/+/, '');
  return '/' + normalized + '?v=' + encodeURIComponent(STATIC_ASSET_VERSION);
}

export function isVersionedStaticAsset(pathname: string, version: string | null | undefined): boolean {
  if (version !== STATIC_ASSET_VERSION) return false;
  return /^\/(?:app|style|analytics|local-time|locale-time)\.js$/.test(pathname)
    || pathname === '/style.css'
    || /^\/(?:favicon\.svg|favicon\.ico|og-default\.png)$/.test(pathname)
    || pathname === '/community.js'
    || pathname === '/community-admin.js';
}
