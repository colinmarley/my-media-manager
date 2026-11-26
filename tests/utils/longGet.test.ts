// @vitest-environment node
import http from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it } from 'vitest';

import { longGet } from '../../src/app/api/disc-ripper/longGet';

let server: http.Server | null = null;

/** A local upstream; `handler` decides when (or whether) to answer. */
async function upstream(handler: http.RequestListener): Promise<string> {
  server = http.createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve(null)));
  server = null;
});

describe('longGet (disc scans through the disc-ripper proxy)', () => {
  it('passes on a slow answer whole, with its status and type', async () => {
    const base = await upstream((req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ titles: [1, 2], url: req.url }));
      }, 300);
    });

    const response = await longGet(`${base}/disc/info?min_length=0`, new AbortController().signal, 5_000);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ titles: [1, 2], url: '/disc/info?min_length=0' });
  });

  it('gives up with 504 once the limit passes without an answer', async () => {
    const base = await upstream(() => { /* never answers */ });
    const response = await longGet(`${base}/disc/info`, new AbortController().signal, 200);
    expect(response.status).toBe(504);
  });

  it('stops waiting and closes the upstream request when the browser leaves', async () => {
    let upstreamClosed = false;
    const base = await upstream((req) => { req.socket.on('close', () => { upstreamClosed = true; }); });
    const browser = new AbortController();

    const pending = longGet(`${base}/disc/info`, browser.signal, 5_000);
    setTimeout(() => browser.abort(), 100);
    const response = await pending;

    expect(response.status).toBe(499);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(upstreamClosed).toBe(true);
  });

  it('answers 502 when the ripper cannot be reached', async () => {
    const base = await upstream(() => {});
    const closedPort = base;
    server!.close();
    server = null;
    const response = await longGet(`${closedPort}/disc/info`, new AbortController().signal, 5_000);
    expect(response.status).toBe(502);
  });
});
