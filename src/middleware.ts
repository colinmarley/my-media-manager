import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/_next', '/favicon.ico', '/api/backend', '/api/disc-ripper'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionCookie = request.cookies.get('session_id');

  // Redirect authenticated users away from root and login straight to the dashboard.
  // (Cookie presence doesn't guarantee the session is still valid server-side, but
  // that's handled by the API calls within the dashboard itself.)
  if (sessionCookie && (pathname === '/' || pathname === '/login')) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // Static / public paths never need a session.
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // All other paths require a session cookie.
  if (!sessionCookie) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/:path*'],
};
