const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** POST JSON with retries on rate limits and server errors. Free tiers rate-limit hard, so this matters. */
export async function postJson(url: string, headers: Record<string, string>, body: unknown, attempts = 5): Promise<any> {
  let lastError = '';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();

    const text = await res.text();
    lastError = `HTTP ${res.status}: ${text.slice(0, 300)}`;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === attempts) break;

    const retryAfter = Number(res.headers.get('retry-after'));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** (attempt - 1);
    await sleep(Math.min(wait, 60_000));
  }
  throw new Error(lastError);
}
