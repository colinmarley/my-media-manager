// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/disc-ripper/[...path]/route';
import { middleware } from '@/middleware';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('DISC_RIPPER_URL', 'http://ripper.test:8083');
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('/api/disc-ripper proxy', () => {
  it('targets the runtime DISC_RIPPER_URL', async () => {
    fetchMock.mockResolvedValue(new Response('[]', { headers: { 'content-type': 'application/json' } }));
    const res = await GET(new NextRequest('http://app.test/api/disc-ripper/jobs?status=failed'));
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe('http://ripper.test:8083/jobs?status=failed');
  });

  it('streams the SSE job log without buffering and marks it no-transform', async () => {
    let push!: (s: string) => void;
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (s) => controller.enqueue(new TextEncoder().encode(s));
      },
    });
    fetchMock.mockResolvedValue(new Response(upstreamBody, {
      headers: { 'content-type': 'text/event-stream', 'content-encoding': 'gzip', 'content-length': '99' },
    }));

    const res = await GET(new NextRequest('http://app.test/api/disc-ripper/jobs/j1/log'));
    expect(fetchMock.mock.calls[0][0]).toBe('http://ripper.test:8083/jobs/j1/log');
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(res.headers.get('content-length')).toBeNull();

    // The first event is readable while the upstream stream is still open.
    const reader = res.body!.getReader();
    push('data: line one\n\n');
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toBe('data: line one\n\n');
    await reader.cancel();
  });

  it('forwards a JSON POST body', async () => {
    fetchMock.mockResolvedValue(new Response('{"id":"j2"}', { headers: { 'content-type': 'application/json' } }));
    const res = await POST(new NextRequest('http://app.test/api/disc-ripper/jobs/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ titles: [1] }),
    }));
    expect(res.status).toBe(200);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe('{"titles":[1]}');
  });

  it('returns 502 when the ripper is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await GET(new NextRequest('http://app.test/api/disc-ripper/disc/info'));
    expect(res.status).toBe(502);
  });
});

describe('middleware session gate for /api/disc-ripper', () => {
  it('rejects requests without a session cookie with 401', () => {
    const res = middleware(new NextRequest('http://app.test/api/disc-ripper/jobs'));
    expect(res.status).toBe(401);
  });

  it('lets requests with a session cookie through', () => {
    const res = middleware(new NextRequest('http://app.test/api/disc-ripper/jobs', {
      headers: { cookie: 'session_id=abc' },
    }));
    expect(res.status).toBe(200);
  });

  it('keeps /api/backend public (the backend does its own auth)', () => {
    const res = middleware(new NextRequest('http://app.test/api/backend/auth/login'));
    expect(res.status).toBe(200);
  });
});
