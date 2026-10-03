/**
 * Kriya Omnitask — Reach Browser Driver Layer (WP-5.5, Blueprint §10, §15, ADR-022)
 *
 * Implements isolated worker drivers:
 * 1. HermeticMockBrowserDriver: High-fidelity, zero-dependency in-memory driver for hermetic unit tests.
 * 2. PlaywrightBrowserDriver: Production driver running Playwright in an isolated process with per-run incognito sessions.
 */

import { createHash } from 'node:crypto';
import { logger } from '../../core/logger/logger.js';
import { ReachSessionConfig, ReachExecutionError, ReachTimeoutError } from '../types/reachTypes.js';
import { ReachSecurityPolicy } from '../security/reachSecurityPolicy.js';
import { getAppMode } from '../../core/config/runtimeMode.js';
import { PolicyViolationError } from '../../core/errors/errors.js';

export interface ReachBrowserSession {
  navigate(url: string, timeoutMs?: number): Promise<{ url: string; title: string; statusCode?: number }>;
  click(selector: string, timeoutMs?: number): Promise<void>;
  fill(selector: string, value: string, timeoutMs?: number): Promise<void>;
  select(selector: string, value: string, timeoutMs?: number): Promise<void>;
  extractText(selector: string, timeoutMs?: number): Promise<string>;
  waitForSelector(selector: string, timeoutMs?: number): Promise<boolean>;
  captureScreenshot(): Promise<{ buffer: Buffer; base64: string; sha256: string }>;
  getCurrentUrl(): string;
  close(): Promise<void>;
}

export interface ReachBrowserDriver {
  createSession(config: ReachSessionConfig, abortSignal?: AbortSignal): Promise<ReachBrowserSession>;
}

// ============================================================================
// Hermetic Mock Browser Driver (Test & Offline Execution)
// ============================================================================

export class HermeticMockBrowserSession implements ReachBrowserSession {
  private currentUrl = 'about:blank';
  private currentTitle = 'Blank Page';
  private dom: Map<string, { text?: string; value?: string; selected?: string }> = new Map();
  private cookies: Map<string, string> = new Map();
  private isClosed = false;

  constructor(
    private readonly config: ReachSessionConfig,
    private readonly abortSignal?: AbortSignal
  ) {
    this.checkAborted();
  }

  private checkAborted(): void {
    if (this.abortSignal?.aborted) {
      throw new ReachExecutionError(
        `Session execution aborted: ${this.abortSignal.reason?.message || 'Aborted'}`
      );
    }
    if (this.isClosed) {
      throw new ReachExecutionError('Cannot perform actions on a closed Reach browser session.');
    }
  }

  public async navigate(url: string, timeoutMs = 10000): Promise<{ url: string; title: string; statusCode?: number }> {
    this.checkAborted();

    // Enforce security policy on navigation
    ReachSecurityPolicy.validateUrl(url, this.config.allowedDomains);

    this.currentUrl = url;
    const parsed = new URL(url);
    this.currentTitle = `${parsed.hostname} Portal View`;

    // Populate standard mock interactive elements based on path/domain
    this.dom.set('title', { text: this.currentTitle });
    this.dom.set('h1', { text: `Welcome to ${parsed.hostname}` });
    this.dom.set('#status', { text: 'Ready' });

    return {
      url: this.currentUrl,
      title: this.currentTitle,
      statusCode: 200,
    };
  }

  public async click(selector: string, _timeoutMs = 5000): Promise<void> {
    this.checkAborted();
    const elem = this.dom.get(selector) || {};
    this.dom.set(selector, { ...elem, text: 'Clicked' });

    // Simulate state progression on click
    if (selector.includes('submit') || selector.includes('book') || selector.includes('confirm')) {
      this.dom.set('#confirmation-message', { text: 'Booking successfully confirmed on portal' });
      this.dom.set('#booking-ref', { text: 'REF-PORTAL-98765' });
    }
  }

  public async fill(selector: string, value: string, _timeoutMs = 5000): Promise<void> {
    this.checkAborted();
    this.dom.set(selector, { value, text: value });
  }

  public async select(selector: string, value: string, _timeoutMs = 5000): Promise<void> {
    this.checkAborted();
    this.dom.set(selector, { selected: value, value, text: value });
  }

  public async extractText(selector: string, _timeoutMs = 5000): Promise<string> {
    this.checkAborted();
    const elem = this.dom.get(selector);
    if (!elem) {
      if (selector === 'body') {
        return Array.from(this.dom.entries())
          .map(([k, v]) => `${k}: ${v.text || v.value || ''}`)
          .join('\n');
      }
      return '';
    }
    return elem.text || elem.value || '';
  }

  public async waitForSelector(selector: string, _timeoutMs = 5000): Promise<boolean> {
    this.checkAborted();
    return this.dom.has(selector);
  }

  public async captureScreenshot(): Promise<{ buffer: Buffer; base64: string; sha256: string }> {
    this.checkAborted();

    // Generate a valid 1x1 transparent PNG buffer with embedded URL metadata
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
      0x42, 0x60, 0x82,
    ]);

    // Append session metadata payload to ensure distinct hashes per page state
    const metadataPayload = Buffer.from(`\nURL:${this.currentUrl}\nTITLE:${this.currentTitle}\nTIME:${Date.now()}`);
    const buffer = Buffer.concat([pngHeader, metadataPayload]);
    const base64 = buffer.toString('base64');
    const sha256 = createHash('sha256').update(buffer).digest('hex');

    return { buffer, base64, sha256 };
  }

  public getCurrentUrl(): string {
    return this.currentUrl;
  }

  public async close(): Promise<void> {
    this.isClosed = true;
    this.dom.clear();
    this.cookies.clear();
  }
}

export class HermeticMockBrowserDriver implements ReachBrowserDriver {
  public async createSession(config: ReachSessionConfig, abortSignal?: AbortSignal): Promise<ReachBrowserSession> {
    if (getAppMode() === 'production' || process.env.APP_MODE === 'production') {
      throw new PolicyViolationError(
        'HermeticMockBrowserDriver is strictly prohibited in production mode. PlaywrightBrowserDriver must be used for live automation.'
      );
    }
    return new HermeticMockBrowserSession(config, abortSignal);
  }
}

// ============================================================================
// Playwright Browser Driver (Production Multi-Process Headless Browser)
// ============================================================================

export class PlaywrightBrowserDriver implements ReachBrowserDriver {
  public async createSession(config: ReachSessionConfig, abortSignal?: AbortSignal): Promise<ReachBrowserSession> {
    let playwright: any;
    try {
      // Dynamic import to prevent hard build crash if playwright is not installed
      // @ts-ignore
      playwright = await import('playwright');
    } catch {
      try {
        // @ts-ignore
        playwright = await import('playwright-core');
      } catch {
        throw new ReachExecutionError(
          'Playwright is not installed in this environment. Install playwright or use HermeticMockBrowserDriver.'
        );
      }
    }

    const browser = await playwright.chromium.launch({
      headless: config.headless !== false,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-setuid-sandbox',
        '--no-first-run',
        '--no-zygote',
      ],
    });

    // Per-run isolated incognito browser context
    const context = await browser.newContext({
      viewport: config.viewport || { width: 1280, height: 800 },
      userAgent: 'Kriya-Reach-Worker/1.0 (Autonomous Business Operations)',
      ignoreHTTPSErrors: false,
    });

    const page = await context.newPage();

    // Security route interceptor: block any navigation outside allowlisted domains
    await page.route('**/*', (route: any) => {
      const requestUrl = route.request().url();
      try {
        // Enforce security policy on any resource/sub-resource navigation
        ReachSecurityPolicy.validateUrl(requestUrl, config.allowedDomains);
        route.continue();
      } catch {
        route.abort('blockedbyclient');
      }
    });

    return new PlaywrightBrowserSession(browser, context, page, config, abortSignal);
  }
}

class PlaywrightBrowserSession implements ReachBrowserSession {
  private isClosed = false;

  constructor(
    private readonly browser: any,
    private readonly context: any,
    private readonly page: any,
    private readonly config: ReachSessionConfig,
    private readonly abortSignal?: AbortSignal
  ) {
    if (this.abortSignal) {
      this.abortSignal.addEventListener('abort', () => {
        this.close().catch(() => {});
      });
    }
  }

  private checkAborted(): void {
    if (this.abortSignal?.aborted) {
      throw new ReachExecutionError(
        `Session execution aborted: ${this.abortSignal.reason?.message || 'Aborted'}`
      );
    }
    if (this.isClosed) {
      throw new ReachExecutionError('Cannot perform actions on a closed Reach browser session.');
    }
  }

  public async navigate(url: string, timeoutMs = 15000): Promise<{ url: string; title: string; statusCode?: number }> {
    this.checkAborted();
    ReachSecurityPolicy.validateUrl(url, this.config.allowedDomains);

    const response = await this.page.goto(url, {
      timeout: timeoutMs,
      waitUntil: 'domcontentloaded',
    });

    const finalUrl = this.page.url();
    ReachSecurityPolicy.validateUrl(finalUrl, this.config.allowedDomains);

    const title = await this.page.title();
    return {
      url: finalUrl,
      title,
      statusCode: response ? response.status() : 200,
    };
  }

  public async click(selector: string, timeoutMs = 5000): Promise<void> {
    this.checkAborted();
    await this.page.click(selector, { timeout: timeoutMs });
  }

  public async fill(selector: string, value: string, timeoutMs = 5000): Promise<void> {
    this.checkAborted();
    await this.page.fill(selector, value, { timeout: timeoutMs });
  }

  public async select(selector: string, value: string, timeoutMs = 5000): Promise<void> {
    this.checkAborted();
    await this.page.selectOption(selector, value, { timeout: timeoutMs });
  }

  public async extractText(selector: string, timeoutMs = 5000): Promise<string> {
    this.checkAborted();
    const elem = await this.page.waitForSelector(selector, { timeout: timeoutMs });
    if (!elem) return '';
    return (await elem.innerText()) || '';
  }

  public async waitForSelector(selector: string, timeoutMs = 5000): Promise<boolean> {
    this.checkAborted();
    try {
      const elem = await this.page.waitForSelector(selector, { timeout: timeoutMs });
      return elem !== null;
    } catch {
      return false;
    }
  }

  public async captureScreenshot(): Promise<{ buffer: Buffer; base64: string; sha256: string }> {
    this.checkAborted();
    const buffer = await this.page.screenshot({ type: 'png', fullPage: false });
    const base64 = buffer.toString('base64');
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    return { buffer, base64, sha256 };
  }

  public getCurrentUrl(): string {
    return this.page.url();
  }

  public async close(): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;

    try {
      await this.page.close().catch(() => {});
      await this.context.close().catch(() => {});
      await this.browser.close().catch(() => {});
    } catch (err) {
      logger.error('Error closing Playwright browser session', err);
    }
  }
}
