import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/_next', '/favicon.ico', '/api/backend', '/api/disc-ripper'];
const CORRELATION_HEADER = 'X-Correlation-ID';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionCookie = request.cookies.get('session_id');

  const correlationId = request.headers.get(CORRELATION_HEADER) ?? crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CORRELATION_HEADER, correlationId);
  const forward = { request: { headers: requestHeaders } };

  // Redirect authenticated users away from root and login straight to the dashboard.
  // (Cookie presence doesn't guarantee the session is still valid server-side, but
  // that's handled by the API calls within the dashboard itself.)
  if (sessionCookie && (pathname === '/' || pathname === '/login')) {
    const response = NextResponse.redirect(new URL('/dashboard', request.url));
    response.headers.set(CORRELATION_HEADER, correlationId);
    return response;
  }

  // Static / public paths never need a session.
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    const response = NextResponse.next(forward);
    response.headers.set(CORRELATION_HEADER, correlationId);
    return response;
  }

  // All other paths require a session cookie.
  if (!sessionCookie) {
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.headers.set(CORRELATION_HEADER, correlationId);
    return response;
  }

  const response = NextResponse.next(forward);
  response.headers.set(CORRELATION_HEADER, correlationId);
  return response;
}

export const config = {
  matcher: ['/:path*'],
};
