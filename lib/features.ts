// Communities stay available for local development, but cannot be enabled in production.
export const COMMUNITIES_ENABLED = process.env.NODE_ENV !== 'production';
export const COMMUNITIES_COMING_LATER_MESSAGE = 'Communities are coming later';
export const SHOW_PRODUCTION_FEATURE_NOTICES = process.env.NODE_ENV === 'production';

export function isCommunitiesPath(pathname: string): boolean {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Invalid encodings are rejected by routing; match the original path defensively.
  }
  const normalized = decoded.replace(/\/+/g, '/').toLowerCase();
  return ['/communities', '/api/community', '/api/post'].some(prefix =>
    normalized === prefix || normalized.startsWith(`${prefix}/`)
  );
}
