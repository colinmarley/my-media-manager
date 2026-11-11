// Use the Next.js API proxy so cookies are set on the same origin as the frontend.
// /api/backend/* → backend server (avoids cross-origin cookie issues)
const API_BASE = '/api/backend';

/**
 * A non-2xx response. The message keeps the historical "API error <status>: <body>" text that
 * callers match on; `status` lets new code branch without parsing it.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`API error ${status}: ${body}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/** The HTTP status of a failed api call, also for errors from before ApiError existed. */
export function apiErrorStatus(error: unknown): number | null {
  if (error instanceof ApiError) return error.status;
  const match = error instanceof Error ? /^API error (\d{3})/.exec(error.message) : null;
  return match ? Number(match[1]) : null;
}

async function apiFetch<T>(path: string, options: RequestInit = {}, timeoutMs = 12000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      signal: controller.signal,
      ...options,
    });

    if (!res.ok) {
      let body = '';
      try {
        body = await res.text();
      } catch {
        body = '';
      }
      throw new ApiError(res.status, body);
    }

    return res.json() as Promise<T>;
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Request timed out. Please check that the backend is running and try again.');
    }
    if (err instanceof TypeError) {
      throw new Error('Could not reach backend service. Verify Docker services are running.');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  get:    <T>(path: string)                => apiFetch<T>(path),
  post:   <T>(path: string, body: unknown) => apiFetch<T>(path, { method: 'POST',   body: JSON.stringify(body) }),
  put:    <T>(path: string, body: unknown) => apiFetch<T>(path, { method: 'PUT',    body: JSON.stringify(body) }),
  patch:  <T>(path: string, body: unknown) => apiFetch<T>(path, { method: 'PATCH',  body: JSON.stringify(body) }),
  delete: <T>(path: string)               => apiFetch<T>(path, { method: 'DELETE' }),
  // Multipart upload: empty headers so the browser sets the multipart boundary.
  postForm: <T>(path: string, body: FormData, timeoutMs?: number) =>
    apiFetch<T>(path, { method: 'POST', body, headers: {} }, timeoutMs),
};
