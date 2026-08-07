import { fetchWithRetry, withRetry } from './retry';

describe('withRetry', () => {
  it('returns the result on the first success, without retrying', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { retries: 2, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries after a failure and succeeds within the retry budget', async () => {
    const fn = jest.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce('ok');
    const result = await withRetry(fn, { retries: 2, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up and throws the last error once retries are exhausted', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('always fails'));
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3); // first attempt + 2 retries
  });

  it('treats a call that never resolves as a timeout, not a hang', async () => {
    const neverResolves = () => new Promise<string>(() => {});
    await expect(withRetry(neverResolves, { retries: 0, timeoutMs: 50 })).rejects.toThrow(/timed out/);
  });
});

describe('fetchWithRetry', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('does not retry a 4xx — the request is bad and a retry cannot fix that', async () => {
    const mockFetch = jest.fn().mockResolvedValue(new Response('bad request', { status: 400 }));
    global.fetch = mockFetch as unknown as typeof fetch;

    const res = await fetchWithRetry('https://example.test', {}, { retries: 3 });
    expect(res.status).toBe(400);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx, since a transient upstream failure might resolve on a second attempt', async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce(new Response('oops', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    global.fetch = mockFetch as unknown as typeof fetch;

    const res = await fetchWithRetry('https://example.test', {}, { retries: 2, baseDelayMs: 1 });
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries a transport-level failure (fetch itself rejecting)', async () => {
    const mockFetch = jest
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    global.fetch = mockFetch as unknown as typeof fetch;

    const res = await fetchWithRetry('https://example.test', {}, { retries: 2, baseDelayMs: 1 });
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
