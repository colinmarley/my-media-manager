import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { Readable } from 'stream';
import type { ChildProcess } from 'child_process';

// Server-side only: the browser never talks to disc-ripper-service directly, it
// goes through this proxy (behind the session check in middleware.ts). Read per
// request so the URL is runtime config (DISC_RIPPER_URL), not baked in at build.
// NEXT_PUBLIC_DISC_RIPPER_URL is the legacy name, kept as a fallback.
function discRipperBaseUrl(): string {
  return (
    process.env.DISC_RIPPER_URL
    || process.env.NEXT_PUBLIC_DISC_RIPPER_URL
    || 'http://localhost:8083'
  ).replace(/\/$/, '');
}

export const dynamic = 'force-dynamic';

// Response headers that must not be copied from the upstream fetch: hop-by-hop
// headers, and content-encoding/length because fetch() has already decoded the
// body (forwarding them would make the browser try to decode it again).
const DROP_RESPONSE_HEADERS = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
  'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
  'content-encoding', 'content-length',
]);

// Matches /jobs/<id>/files/<n>/stream
const STREAM_PATH_RE = /^\/jobs\/[^/]+\/files\/\d+\/stream$/;
// Matches /jobs/<id>/files/<n>/metadata
const METADATA_PATH_RE = /^\/jobs\/[^/]+\/files\/\d+\/metadata$/;

// Wraps a Node.js readable into a Web ReadableStream that kills the ffmpeg
// process when the browser disconnects mid-stream, preventing the
// "Invalid state: Controller is already closed" uncaughtException that
// happens when Readable.toWeb() tries to enqueue after the client disconnects.
function ffmpegToWebStream(
  ffmpeg: ChildProcess,
  nodeInput: Readable,
): ReadableStream<Uint8Array> {
  let cancelled = false;

  const cleanup = () => {
    if (cancelled) return;
    cancelled = true;
    try { nodeInput.destroy(); } catch { /* ignore */ }
    try { ffmpeg.kill(); } catch { /* ignore */ }
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const stdout = ffmpeg.stdout!;

      stdout.on('data', (chunk: Buffer) => {
        if (cancelled) return;
        try {
          controller.enqueue(new Uint8Array(chunk));
        } catch {
          cleanup();
        }
      });

      stdout.on('end', () => {
        if (cancelled) return;
        try { controller.close(); } catch { /* already closed */ }
      });

      stdout.on('error', (err) => {
        if (cancelled) return;
        try { controller.error(err); } catch { /* already closed */ }
        cleanup();
      });

      ffmpeg.on('error', (err) => {
        if (cancelled) return;
        try { controller.error(err); } catch { /* already closed */ }
        cleanup();
      });
    },

    cancel() {
      cleanup();
    },
  });
}

// Transcode the MKV stream to fragmented H.264/AAC MP4 for browser playback.
// MPEG-2/AC3 MKV (raw DVD rips) can't be decoded natively by browsers.
async function transcodeStream(upstreamUrl: string): Promise<NextResponse> {
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl);
  } catch {
    return new NextResponse('Disc ripper unreachable', { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return new NextResponse(await upstream.text(), { status: upstream.status });
  }

  const ffmpeg = spawn('ffmpeg', [
    '-i', 'pipe:0',
    '-vf', 'scale=-2:min(ih\\,480)',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '28',
    '-c:a', 'aac', '-ac', '2', '-ar', '44100',
    '-sn',
    '-movflags', 'frag_keyframe+empty_moov+faststart',
    '-f', 'mp4',
    'pipe:1',
  ], { stdio: ['pipe', 'pipe', 'ignore'] });

  const nodeIn = Readable.fromWeb(upstream.body as import('stream/web').ReadableStream<Uint8Array>);
  nodeIn.pipe(ffmpeg.stdin);
  nodeIn.on('error', () => ffmpeg.kill());
  ffmpeg.stdin.on('error', () => { /* browser closed connection */ });

  const webStream = ffmpegToWebStream(ffmpeg, nodeIn);

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      'content-type': 'video/mp4',
      'cache-control': 'no-store',
      'x-transcode': 'ffmpeg-ultrafast',
    },
  });
}

// Run ffprobe on the MKV stream to extract duration. MKV stores duration in
// its EBML header near the start of the file, so ffprobe exits quickly.
async function getFileMetadata(streamUrl: string): Promise<NextResponse> {
  let upstream: Response;
  try {
    upstream = await fetch(streamUrl);
  } catch {
    return NextResponse.json({ error: 'disc ripper unreachable' }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: `upstream ${upstream.status}` }, { status: upstream.status });
  }

  const ffprobe = spawn('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-i', 'pipe:0',
  ], { stdio: ['pipe', 'pipe', 'ignore'] });

  const nodeIn = Readable.fromWeb(upstream.body as import('stream/web').ReadableStream<Uint8Array>);
  nodeIn.pipe(ffprobe.stdin);
  nodeIn.on('error', () => ffprobe.kill());
  ffprobe.stdin.on('error', () => { /* ffprobe exited, pipe broken */ });

  const chunks: Buffer[] = [];
  ffprobe.stdout!.on('data', (c: Buffer) => chunks.push(c));

  await new Promise<void>((resolve) => ffprobe.on('close', resolve));
  nodeIn.destroy();

  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const duration = parseFloat(parsed.format?.duration ?? '0');
    return NextResponse.json({ duration });
  } catch {
    return NextResponse.json({ error: 'parse failed' }, { status: 500 });
  }
}

// Plain proxy for all other disc ripper API calls: JSON endpoints and the
// job log, which is Server-Sent Events (GET /jobs/<id>/log, consumed by an
// EventSource in MonitorStep). The upstream body is passed through as a stream,
// never buffered, and the upstream request is aborted when the browser leaves.
async function plainProxy(request: NextRequest, path: string): Promise<NextResponse> {
  const { search } = request.nextUrl;
  const url = `${discRipperBaseUrl()}${path}${search}`;

  let upstream: Response;
  try {
    const forwardHeaders: Record<string, string> = {};
    for (const k of ['content-type', 'accept', 'authorization', 'last-event-id']) {
      const v = request.headers.get(k);
      if (v) forwardHeaders[k] = v;
    }
    const init: RequestInit = { method: request.method, headers: forwardHeaders, signal: request.signal };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      // Request bodies here are small JSON payloads; buffering avoids Node
      // fetch's streaming-body (duplex) requirement.
      const body = await request.arrayBuffer();
      if (body.byteLength > 0) init.body = body;
    }
    upstream = await fetch(url, init);
  } catch {
    return new NextResponse('Disc ripper unreachable', { status: 502 });
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((v, k) => {
    if (!k.startsWith('access-control-') && !DROP_RESPONSE_HEADERS.has(k)) responseHeaders.set(k, v);
  });

  if ((upstream.headers.get('content-type') ?? '').startsWith('text/event-stream')) {
    // no-transform keeps Next's compression from buffering the stream;
    // X-Accel-Buffering disables buffering in an nginx-style reverse proxy.
    responseHeaders.set('cache-control', 'no-cache, no-transform');
    responseHeaders.set('x-accel-buffering', 'no');
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

async function handler(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const path = pathname.replace(/^\/api\/disc-ripper/, '');

  const base = discRipperBaseUrl();
  if (STREAM_PATH_RE.test(path)) {
    return transcodeStream(`${base}${path}`);
  }
  if (METADATA_PATH_RE.test(path)) {
    const streamUrl = `${base}${path.replace('/metadata', '/stream')}`;
    return getFileMetadata(streamUrl);
  }
  return plainProxy(request, path);
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
