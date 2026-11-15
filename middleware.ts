import { NextRequest, NextResponse } from 'next/server';
import { COMMUNITIES_ENABLED, COMMUNITIES_COMING_LATER_MESSAGE, isCommunitiesPath } from './lib/features';

export function middleware(request: NextRequest) {
  if (!COMMUNITIES_ENABLED && isCommunitiesPath(request.nextUrl.pathname)) {
    return NextResponse.json({ status: 404, message: COMMUNITIES_COMING_LATER_MESSAGE }, { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
