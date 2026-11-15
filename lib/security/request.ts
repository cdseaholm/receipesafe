import type { NextRequest } from 'next/server';

/** Cookie-authenticated JSON mutations reject browser cross-origin submissions. */
export function isSameOriginJSON(request: NextRequest) {
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return false;
    const origin = request.headers.get('origin');
    return !origin || origin === new URL(request.url).origin;
}
