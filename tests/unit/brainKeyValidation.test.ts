/**
 * Kriya Omnitask — BYO brain key validation (docs/kriya S28)
 * Validation must contact the provider; it used to accept any key not starting with "sk-invalid".
 */

import { describe, it, expect } from 'vitest';
import { BrainCredentialService } from '../../src/model/brain/services/brainCredentialService.js';
import { CredentialVault } from '../../src/tools/vault/credentialVault.js';
import { BrainSupplyRepository } from '../../src/model/brain/repositories/brainSupplyRepository.js';

const svc = (fetchFn: (url: string, init?: RequestInit) => Promise<Response>) =>
  new BrainCredentialService(new CredentialVault(), {} as BrainSupplyRepository, fetchFn);

describe('BYO key validation', () => {
  it('asks the provider and accepts only a 200', async () => {
    let calledUrl = '';
    const ok = await svc(async (url) => ((calledUrl = url), new Response('{}', { status: 200 }))).validateKey('openrouter', 'sk-or-v1-goodkey123');
    expect(ok.valid).toBe(true);
    expect(calledUrl).toMatch(/\/key$/);

    const bad = await svc(async () => new Response('', { status: 401 })).validateKey('openrouter', 'sk-or-v1-looks-fine-but-revoked');
    expect(bad.valid).toBe(false);
    expect(bad.errorMessage).toContain('401');
  });

  it('never accepts a key it could not verify', async () => {
    const down = await svc(async () => {
      throw new Error('ECONNRESET');
    }).validateKey('openrouter', 'sk-or-v1-goodkey123');
    expect(down.valid).toBe(false);
    expect(down.errorMessage).toContain('not saved');

    const flaky = await svc(async () => new Response('', { status: 503 })).validateKey('openrouter', 'sk-or-v1-goodkey123');
    expect(flaky.valid).toBe(false);
  });

  it('refuses providers it cannot execute with yet', async () => {
    const res = await svc(async () => new Response('{}', { status: 200 })).validateKey('anthropic', 'sk-ant-whatever-long-key');
    expect(res.valid).toBe(false);
    expect(res.errorMessage).toContain('OpenRouter');
  });
});

const liveKey = process.env.KRIYA_LIVE_TEST_OPENROUTER_KEY;
describe.skipIf(!liveKey)('Live BYO key validation (OpenRouter /key, no tokens spent)', () => {
  it('accepts the real key and rejects a fabricated one', async () => {
    const service = new BrainCredentialService(new CredentialVault(), {} as BrainSupplyRepository);
    expect((await service.validateKey('openrouter', liveKey!)).valid).toBe(true);
    expect((await service.validateKey('openrouter', 'sk-or-v1-0000000000000000000000000000')).valid).toBe(false);
  }, 30_000);
});
