/** Shared fetch helper: JSON in/out, timeout, and a descriptive error on non-2xx. */
export async function fetchJson<T>(
  url: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const { timeoutMs = 15_000, ...rest } = init ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: controller.signal });
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 300)}`);
    }
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}
