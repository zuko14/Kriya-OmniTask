/**
 * Kriya Omnitask — Model Provider Adapters (resilience layer)
 * Per-provider adapters used by the fallback chain and certified router.
 *
 * Outside sandbox every provider executes for real through OpenRouter (decision D2), with the
 * provider prefix applied to the model id; 'local' executes against an OpenAI-compatible
 * local server (Ollama/vLLM) at OLLAMA_BASE_URL. Sandbox/test return clearly labelled simulated
 * output and are the only modes where failure injection (`mockFailure`) is honoured (docs/kriya S18, S22).
 */

import { ModelProvider } from '../types/modelResilienceTypes.js';
import { config } from '../../../core/config/config.js';
import { isSandboxMode, NotConfiguredError } from '../../../core/config/runtimeMode.js';
import { OpenRouterAdapter } from '../../gateway/openRouterAdapter.js';

export interface ModelExecutionOptions {
  systemInstruction?: string;
  temperature?: number;
  maxTokens?: number;
  /** Failure injection for resilience drills. Honoured ONLY in sandbox/test mode. */
  mockFailure?: boolean;
}

export interface ProviderExecutionResult {
  outputText: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  /** Provider-reported USD cost when available (real executions only). */
  costUsd?: number | null;
}

export interface IModelProviderAdapter {
  readonly provider: ModelProvider;
  execute(
    modelIdentifier: string,
    prompt: string,
    options?: ModelExecutionOptions
  ): Promise<ProviderExecutionResult>;
}

abstract class BaseProviderAdapter implements IModelProviderAdapter {
  public abstract readonly provider: ModelProvider;
  /** Label used in sandbox output and simulated outage messages. */
  protected abstract readonly label: string;
  protected abstract readonly simulatedOutage: (model: string) => string;
  private realAdapter?: OpenRouterAdapter;

  public async execute(
    modelIdentifier: string,
    prompt: string,
    options?: ModelExecutionOptions
  ): Promise<ProviderExecutionResult> {
    if (isSandboxMode()) return this.simulate(modelIdentifier, prompt, options);

    const start = Date.now();
    const res = await this.getRealAdapter().execute(
      this.toProviderModel(modelIdentifier),
      options?.systemInstruction ?? 'You are a helpful, precise business assistant.',
      prompt,
      { temperature: options?.temperature, maxTokens: options?.maxTokens }
    );
    return {
      outputText: res.content,
      promptTokens: res.promptTokens,
      completionTokens: res.completionTokens,
      latencyMs: Date.now() - start,
      costUsd: res.costUsd,
    };
  }

  /** OpenRouter model slug for this provider; full slugs (with '/') pass through. */
  protected toProviderModel(modelIdentifier: string): string {
    return modelIdentifier.includes('/') ? modelIdentifier : `${this.provider}/${modelIdentifier}`;
  }

  protected createRealAdapter(): OpenRouterAdapter {
    if (!config.get('OPENROUTER_API_KEY')) {
      throw new NotConfiguredError(`${this.label} model provider`, 'set OPENROUTER_API_KEY.');
    }
    return new OpenRouterAdapter();
  }

  private getRealAdapter(): OpenRouterAdapter {
    if (!this.realAdapter) this.realAdapter = this.createRealAdapter();
    return this.realAdapter;
  }

  private simulate(model: string, prompt: string, options?: ModelExecutionOptions): ProviderExecutionResult {
    if (options?.mockFailure) throw new Error(this.simulatedOutage(model));
    const outputText = `[SANDBOX][${this.label} ${model} Response]: simulated output, no real model was called.`;
    return {
      outputText,
      promptTokens: Math.ceil(prompt.length / 4),
      completionTokens: Math.ceil(outputText.length / 4),
      latencyMs: 0,
    };
  }
}

export class GoogleProviderAdapter extends BaseProviderAdapter {
  public readonly provider: ModelProvider = 'google';
  protected readonly label = 'Google';
  protected readonly simulatedOutage = (m: string) => `Google Vertex AI 503: Quota exceeded for model '${m}'`;
}

export class OpenAIProviderAdapter extends BaseProviderAdapter {
  public readonly provider: ModelProvider = 'openai';
  protected readonly label = 'OpenAI';
  protected readonly simulatedOutage = (m: string) => `OpenAI API 429: Rate limit reached for model '${m}'`;
}

export class AnthropicProviderAdapter extends BaseProviderAdapter {
  public readonly provider: ModelProvider = 'anthropic';
  protected readonly label = 'Anthropic';
  protected readonly simulatedOutage = (m: string) => `Anthropic API 500: Internal server error for model '${m}'`;
}

export class DeepSeekProviderAdapter extends BaseProviderAdapter {
  public readonly provider: ModelProvider = 'deepseek';
  protected readonly label = 'DeepSeek';
  protected readonly simulatedOutage = (m: string) => `DeepSeek API 503: High server load on reasoning cluster for '${m}'`;
}

/** Local inference (zero exfiltration): OpenAI-compatible server such as Ollama or vLLM. */
export class LocalProviderAdapter extends BaseProviderAdapter {
  public readonly provider: ModelProvider = 'local';
  protected readonly label = 'Local Zero-Exfiltration';
  protected readonly simulatedOutage = (m: string) => `Local Inference Engine: VRAM allocation error on '${m}'`;

  protected toProviderModel(modelIdentifier: string): string {
    return modelIdentifier;
  }

  protected createRealAdapter(): OpenRouterAdapter {
    const base = config.get('OLLAMA_BASE_URL');
    if (!base) {
      throw new NotConfiguredError('Local model provider', 'set OLLAMA_BASE_URL to an OpenAI-compatible local server.');
    }
    // Local servers ignore the bearer token; the adapter requires a non-empty value.
    return new OpenRouterAdapter({ apiKey: 'local', baseUrl: `${base.replace(/\/+$/, '')}/v1`, timeoutMs: 120_000 });
  }
}
