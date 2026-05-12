import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://127.0.0.1:8082';

// Parse a raw Set-Cookie header string into name, value, and cookie options.
function parseSetCookie(raw: string): Parameters<NextResponse['cookies']['set']>[0] {
  const [nameVal, ...parts] = raw.split(';').map(s => s.trim());
  const eq = nameVal.indexOf('=');
  const name = nameVal.slice(0, eq);
  const value = nameVal.slice(eq + 1);

  const opts: Record<string, unknown> = { name, value };
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'httponly') { opts.httpOnly = true; continue; }
    if (lower === 'secure') { opts.secure = true; continue; }
    const sep = part.indexOf('=');
    if (sep === -1) continue;
    const k = part.slice(0, sep).toLowerCase().trim();
    const v = part.slice(sep + 1).trim();
    if (k === 'path') opts.path = v;
    else if (k === 'domain') opts.domain = v;
    else if (k === 'max-age') opts.maxAge = parseInt(v, 10);
    else if (k === 'samesite') opts.sameSite = v.toLowerCase() as 'lax' | 'strict' | 'none';
    else if (k === 'expires') opts.expires = new Date(v);
  }
  return opts as Parameters<NextResponse['cookies']['set']>[0];
}

async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const rawBackendPath = pathname.replace(/^\/api\/backend/, '');
  const backendPath = rawBackendPath.startsWith('/api/') ? rawBackendPath : `/api${rawBackendPath}`;
  const url = `${BACKEND_URL}${backendPath}${search}`;

  // Forward headers that the backend needs (content-type, cookie, user-agent)
  const forwardHeaders: Record<string, string> = {};
  const forward = ['content-type', 'cookie', 'user-agent', 'accept', 'authorization'];
  for (const key of forward) {
    const val = request.headers.get(key);
    if (val) forwardHeaders[key] = val;
  }

  const init: RequestInit = {
    method: request.method,
    headers: forwardHeaders,
    // @ts-expect-error duplex required for streaming body in Node.js fetch
    duplex: 'half',
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
  }

  const response = await fetch(url, init);

  // Forward response headers back to the browser, excluding CORS and Set-Cookie
  // (Set-Cookie is handled separately below via cookies.set() for reliable delivery)
  const responseHeaders = new Headers();
  response.headers.forEach((value, key) => {
    if (!key.startsWith('access-control-') && key.toLowerCase() !== 'set-cookie') {
      responseHeaders.set(key, value);
    }
  });

  const proxiedResponse = new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });

  // Forward Set-Cookie via NextResponse.cookies so Next.js reliably delivers
  // them to the browser (the headers constructor alone is not sufficient in all
  // Next.js versions).
  const rawCookies: string[] =
    (response.headers as unknown as { getSetCookie?(): string[] }).getSetCookie?.() ?? [];
  if (rawCookies.length === 0) {
    const single = response.headers.get('set-cookie');
    if (single) rawCookies.push(single);
  }
  for (const raw of rawCookies) {
    proxiedResponse.cookies.set(parseSetCookie(raw));
  }

  return proxiedResponse;
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as DELETE, proxy as PATCH, proxy as OPTIONS };
