import { describe, it, expect } from 'vitest';
import {
  GoogleProviderAdapter,
  OpenAIProviderAdapter,
  AnthropicProviderAdapter,
  DeepSeekProviderAdapter,
  LocalProviderAdapter,
} from '../../src/model/resilience/adapters/modelProviderAdapter.js';

describe('ModelProviderAdapter Unit Tests', () => {
  it('should execute prompts across Google, OpenAI, Anthropic, DeepSeek, and Local adapters', async () => {
    const google = new GoogleProviderAdapter();
    const openai = new OpenAIProviderAdapter();
    const anthropic = new AnthropicProviderAdapter();
    const deepseek = new DeepSeekProviderAdapter();
    const local = new LocalProviderAdapter();

    const resGoogle = await google.execute('gemini-2.5-flash', 'Analyze metrics');
    expect(resGoogle.outputText).toContain('Google gemini-2.5-flash');
    expect(resGoogle.promptTokens).toBeGreaterThan(0);

    const resOpenAI = await openai.execute('gpt-4o', 'Summarize lead');
    expect(resOpenAI.outputText).toContain('OpenAI gpt-4o');

    const resAnthropic = await anthropic.execute('claude-3-7-sonnet', 'Verify policy');
    expect(resAnthropic.outputText).toContain('Anthropic claude-3-7-sonnet');

    const resDeepSeek = await deepseek.execute('deepseek-r1', 'Solve equation');
    expect(resDeepSeek.outputText).toContain('DeepSeek deepseek-r1');

    const resLocal = await local.execute('llama-3.3-70b-local', 'Internal classified audit');
    expect(resLocal.outputText).toContain('Local Zero-Exfiltration');
  });

  it('should throw structured error on simulated provider outage', async () => {
    const google = new GoogleProviderAdapter();
    await expect(
      google.execute('gemini-2.5-pro', 'Crash prompt', { mockFailure: true })
    ).rejects.toThrow('Google Vertex AI 503');
  });
});
