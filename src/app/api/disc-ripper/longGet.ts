import { NextResponse } from 'next/server';
import http from 'http';
import https from 'https';

/**
 * GET `url` and pass its answer on whole, waiting up to `timeoutMs` for it.
 *
 * For upstream calls that answer only when slow work is done: fetch() gives up
 * after 300 s without response headers and cannot be told otherwise without the
 * undici package. Meant for small JSON answers (the body is buffered).
 */
export function longGet(url: string, signal: AbortSignal, timeoutMs: number): Promise<NextResponse> {
  const target = new URL(url);
  const client = target.protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (response: NextResponse) => {
      if (settled) return;
      settled = true;
      resolve(response);
    };
    const upstream = client.get(
      target,
      { headers: { accept: 'application/json', 'accept-encoding': 'identity' }, timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => finish(new NextResponse(new Uint8Array(Buffer.concat(chunks)), {
          status: res.statusCode ?? 502,
          headers: { 'content-type': res.headers['content-type'] ?? 'application/json' },
        })));
        res.on('error', () => finish(new NextResponse('Upstream connection lost', { status: 502 })));
      },
    );
    // `timeout` is socket inactivity, and a slow call sends nothing until it is done.
    upstream.on('timeout', () => {
      upstream.destroy();
      finish(new NextResponse('Upstream took too long', { status: 504 }));
    });
    upstream.on('error', () => finish(new NextResponse('Upstream unreachable', { status: 502 })));
    // The browser left: stop waiting.
    signal.addEventListener('abort', () => {
      upstream.destroy();
      finish(new NextResponse(null, { status: 499 }));
    }, { once: true });
  });
}
