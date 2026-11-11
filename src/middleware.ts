import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// /api/backend stays public: the backend enforces its own session/bearer auth
// (and the login call itself goes through it). /api/disc-ripper is NOT public:
// disc-ripper-service has no auth of its own, so the session check here is its
// only gate. Nothing unauthenticated uses it (the ripper calls the backend
// directly, the mobile app reads rip status via the backend's ripper proxy).
const PUBLIC_PATHS = ['/login', '/_next', '/favicon.ico', '/api/backend'];
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

  // All other paths require a session cookie. API callers get a 401 rather
  // than an HTML redirect to /login.
  if (!sessionCookie && pathname.startsWith('/api/')) {
    const response = NextResponse.json({ detail: 'Not authenticated' }, { status: 401 });
    response.headers.set(CORRELATION_HEADER, correlationId);
    return response;
  }
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
