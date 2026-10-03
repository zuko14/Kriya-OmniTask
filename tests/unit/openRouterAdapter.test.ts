/**
 * Kriya Omnitask — OpenRouter adapter tests (docs/kriya WP-1.2)
 * Uses an injected fetch so no network is touched. A live smoke test runs only when
 * KRIYA_LIVE_TEST_OPENROUTER_KEY is set.
 */

import { describe, it, expect } from 'vitest';
import { OpenRouterAdapter, ProviderError, toOpenRouterModel } from '../../src/model/gateway/openRouterAdapter.js';
import { ModelRouter } from '../../src/orchestration/routing/modelRouter.js';

const KEY = 'sk-or-test-SECRET-123';
const noSleep = async () => {};

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

const okBody = {
  model: 'google/gemini-2.5-flash',
  choices: [{ message: { role: 'assistant', content: '{"ok":true}' } }],
  usage: { prompt_tokens: 120, completion_tokens: 30, cost: 0.000042 },
};

describe('OpenRouterAdapter', () => {
  it('sends a well-formed request and returns real usage and provider cost', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const adapter = new OpenRouterAdapter({
      apiKey: KEY,
      baseUrl: 'https://openrouter.test/api/v1/',
      sleep: noSleep,
      fetchFn: async (url, init) => {
        captured = { url, init: init! };
        return jsonResponse(200, okBody);
      },
    });

    const res = await adapter.execute('gemini-2.5-flash', 'sys', 'user', { jsonMode: true, temperature: 0.1, maxTokens: 256 });

    expect(captured!.url).toBe('https://openrouter.test/api/v1/chat/completions');
    const sent = JSON.parse(String(captured!.init.body));
    expect(sent.model).toBe('google/gemini-2.5-flash');
    expect(sent.response_format).toEqual({ type: 'json_object' });
    expect(sent.max_tokens).toBe(256);
    expect(sent.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'user' },
    ]);
    expect((captured!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(res).toEqual({ content: '{"ok":true}', promptTokens: 120, completionTokens: 30, costUsd: 0.000042, servedModel: 'google/gemini-2.5-flash', truncated: false });
  });

  it('retries 429 then succeeds', async () => {
    let calls = 0;
    const adapter = new OpenRouterAdapter({
      apiKey: KEY,
      sleep: noSleep,
      fetchFn: async () => (++calls === 1 ? jsonResponse(429, { error: 'slow down' }, { 'retry-after': '1' }) : jsonResponse(200, okBody)),
    });
    const res = await adapter.execute('x/y', 's', 'u');
    expect(calls).toBe(2);
    expect(res.content).toBe('{"ok":true}');
  });

  it('does not retry auth failures and never leaks the key', async () => {
    let calls = 0;
    const adapter = new OpenRouterAdapter({
      apiKey: KEY,
      sleep: noSleep,
      fetchFn: async () => {
        calls++;
        return new Response(`invalid key ${KEY}`, { status: 401 });
      },
    });
    const err = await adapter.execute('x/y', 's', 'u').catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe('auth');
    expect(calls).toBe(1);
    expect(err.message).not.toContain(KEY);
    expect(err.message).toContain('[REDACTED]');
  });

  it('gives up after max retries on persistent 5xx', async () => {
    let calls = 0;
    const adapter = new OpenRouterAdapter({ apiKey: KEY, maxRetries: 2, sleep: noSleep, fetchFn: async () => (calls++, new Response('down', { status: 503 })) });
    const err = await adapter.execute('x/y', 's', 'u').catch((e) => e);
    expect(err.kind).toBe('server');
    expect(calls).toBe(3);
  });

  it('treats HTTP 200 with an error object as a failure', async () => {
    const adapter = new OpenRouterAdapter({
      apiKey: KEY,
      maxRetries: 0,
      sleep: noSleep,
      fetchFn: async () => jsonResponse(200, { error: { code: 400, message: 'model not found' } }),
    });
    const err = await adapter.execute('x/y', 's', 'u').catch((e) => e);
    expect(err.kind).toBe('invalid_request');
  });

  it('fails on empty content instead of returning an empty answer', async () => {
    const adapter = new OpenRouterAdapter({
      apiKey: KEY,
      sleep: noSleep,
      fetchFn: async () => jsonResponse(200, { choices: [{ message: { content: '' } }] }),
    });
    const err = await adapter.execute('x/y', 's', 'u').catch((e) => e);
    expect(err.kind).toBe('bad_response');
  });

  it('times out hung requests', async () => {
    const adapter = new OpenRouterAdapter({
      apiKey: KEY,
      timeoutMs: 20,
      maxRetries: 0,
      sleep: noSleep,
      fetchFn: (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });
    const err = await adapter.execute('x/y', 's', 'u').catch((e) => e);
    expect(err.kind).toBe('timeout');
  });

  it('rejects a JSON-mode reply truncated at max_tokens instead of returning partial JSON', async () => {
    const adapter = new OpenRouterAdapter({
      apiKey: KEY,
      sleep: noSleep,
      fetchFn: async () => jsonResponse(200, { choices: [{ message: { content: '{"pong' }, finish_reason: 'length' }], usage: {} }),
    });
    const err = await adapter.execute('x/y', 's', 'u', { jsonMode: true, maxTokens: 5 }).catch((e) => e);
    expect(err.kind).toBe('truncated');
  });

  it('flags (but returns) a truncated free-text reply', async () => {
    const adapter = new OpenRouterAdapter({
      apiKey: KEY,
      sleep: noSleep,
      fetchFn: async () => jsonResponse(200, { choices: [{ message: { content: 'Your report will' }, finish_reason: 'length' }], usage: {} }),
    });
    const res = await adapter.execute('x/y', 's', 'u', { maxTokens: 5 });
    expect(res.truncated).toBe(true);
  });

  it('maps short aliases and passes full slugs through', () => {
    expect(toOpenRouterModel('gpt-4o-mini')).toBe('openai/gpt-4o-mini');
    expect(toOpenRouterModel('anthropic/claude-sonnet-4')).toBe('anthropic/claude-sonnet-4');
  });
});

describe('ModelRouter with a real-shaped adapter', () => {
  it('uses provider-reported cost and passes context to the model', async () => {
    let userSeen = '';
    const adapter = new OpenRouterAdapter({
      apiKey: KEY,
      sleep: noSleep,
      fetchFn: async (_url, init) => {
        userSeen = JSON.parse(String(init!.body)).messages[1].content;
        return jsonResponse(200, okBody);
      },
    });
    const router = new ModelRouter(adapter);
    const res = await router.complete({
      systemPrompt: 's',
      userPrompt: 'What time is my slot?',
      contextData: { slot: '2026-10-02T10:00' },
      policy: { primaryModel: 'unpriced/model', fallbackModel: 'unpriced/model' },
    });
    expect(userSeen).toContain('2026-10-02T10:00');
    expect(res.costSource).toBe('provider');
    expect(res.estimatedCostUsd).toBe(0.000042);
  });

  it('records unknown cost honestly instead of guessing a price', async () => {
    const router = new ModelRouter({ execute: async () => ({ content: 'x', promptTokens: 1, completionTokens: 1 }) });
    const res = await router.complete({ systemPrompt: 's', userPrompt: 'u', policy: { primaryModel: 'unpriced/model', fallbackModel: 'unpriced/model' } });
    expect(res.costSource).toBe('unknown');
    expect(router.calculateCost('unpriced/model', 100, 100)).toBeNull();
  });
});

const liveKey = process.env.KRIYA_LIVE_TEST_OPENROUTER_KEY;
describe.skipIf(!liveKey)('OpenRouter live smoke test', () => {
  it('gets a real JSON completion', async () => {
    const adapter = new OpenRouterAdapter({ apiKey: liveKey! });
    const res = await adapter.execute(process.env.KRIYA_LIVE_TEST_MODEL || 'openai/gpt-4o-mini', 'Reply with JSON only.', 'Return {"pong": true}', { jsonMode: true, maxTokens: 300 });
    expect(JSON.parse(res.content)).toHaveProperty('pong');
    expect(res.promptTokens).toBeGreaterThan(0);
  }, 60_000);
});
