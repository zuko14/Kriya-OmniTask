/**
 * Kriya AI — High-Performance Prometheus Metrics Registry
 * Zero-dependency in-memory Prometheus exposition engine conforming to
 * the official Prometheus text-based exposition format (RFC / OpenMetrics standard).
 */

export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary';

export interface MetricOptions {
  name: string;
  help: string;
  labelNames?: string[];
}

export interface HistogramOptions extends MetricOptions {
  buckets?: number[];
}

const DEFAULT_HISTOGRAM_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10
];

function sanitizeMetricName(name: string): string {
  if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(name)) {
    throw new Error(`Invalid metric name: ${name}`);
  }
  return name;
}

function escapeLabelValue(val: string): string {
  return val
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

function formatLabels(labels?: Record<string, string | number>): string {
  if (!labels || Object.keys(labels).length === 0) {
    return '';
  }
  const pairs = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${escapeLabelValue(String(v))}"`);
  return `{${pairs.join(',')}}`;
}

function labelsKey(labels?: Record<string, string | number>): string {
  if (!labels || Object.keys(labels).length === 0) return '';
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('|');
}

export class Counter {
  public readonly name: string;
  public readonly help: string;
  public readonly type: MetricType = 'counter';
  public readonly labelNames: string[];
  private values = new Map<string, { labels: Record<string, string | number>; value: number }>();

  constructor(options: MetricOptions) {
    this.name = sanitizeMetricName(options.name);
    this.help = options.help;
    this.labelNames = options.labelNames || [];
  }

  public inc(labelsOrVal?: Record<string, string | number> | number, value = 1): void {
    let labels: Record<string, string | number> = {};
    let incVal = value;

    if (typeof labelsOrVal === 'number') {
      incVal = labelsOrVal;
    } else if (labelsOrVal) {
      labels = labelsOrVal;
    }

    if (incVal < 0) {
      throw new Error(`Counter value cannot decrease: ${incVal}`);
    }

    const key = labelsKey(labels);
    const existing = this.values.get(key);
    if (existing) {
      existing.value += incVal;
    } else {
      this.values.set(key, { labels, value: incVal });
    }
  }

  public get(labels?: Record<string, string | number>): number {
    const key = labelsKey(labels);
    return this.values.get(key)?.value ?? 0;
  }

  public reset(): void {
    this.values.clear();
  }

  public serialize(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} ${this.type}`,
    ];

    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
      return lines.join('\n');
    }

    for (const item of this.values.values()) {
      const lbls = formatLabels(item.labels);
      lines.push(`${this.name}${lbls} ${item.value}`);
    }

    return lines.join('\n');
  }
}

export class Gauge {
  public readonly name: string;
  public readonly help: string;
  public readonly type: MetricType = 'gauge';
  public readonly labelNames: string[];
  private values = new Map<string, { labels: Record<string, string | number>; value: number }>();

  constructor(options: MetricOptions) {
    this.name = sanitizeMetricName(options.name);
    this.help = options.help;
    this.labelNames = options.labelNames || [];
  }

  public set(labelsOrVal: Record<string, string | number> | number, value?: number): void {
    let labels: Record<string, string | number> = {};
    let setVal: number;

    if (typeof labelsOrVal === 'number') {
      setVal = labelsOrVal;
    } else {
      labels = labelsOrVal;
      setVal = value ?? 0;
    }

    const key = labelsKey(labels);
    this.values.set(key, { labels, value: setVal });
  }

  public inc(labelsOrVal?: Record<string, string | number> | number, value = 1): void {
    let labels: Record<string, string | number> = {};
    let incVal = value;

    if (typeof labelsOrVal === 'number') {
      incVal = labelsOrVal;
    } else if (labelsOrVal) {
      labels = labelsOrVal;
    }

    const key = labelsKey(labels);
    const existing = this.values.get(key);
    if (existing) {
      existing.value += incVal;
    } else {
      this.values.set(key, { labels, value: incVal });
    }
  }

  public dec(labelsOrVal?: Record<string, string | number> | number, value = 1): void {
    this.inc(labelsOrVal, -value);
  }

  public get(labels?: Record<string, string | number>): number {
    const key = labelsKey(labels);
    return this.values.get(key)?.value ?? 0;
  }

  public reset(): void {
    this.values.clear();
  }

  public serialize(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} ${this.type}`,
    ];

    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
      return lines.join('\n');
    }

    for (const item of this.values.values()) {
      const lbls = formatLabels(item.labels);
      lines.push(`${this.name}${lbls} ${item.value}`);
    }

    return lines.join('\n');
  }
}

interface HistogramEntry {
  labels: Record<string, string | number>;
  buckets: Map<number, number>; // upper bound -> count
  sum: number;
  count: number;
}

export class Histogram {
  public readonly name: string;
  public readonly help: string;
  public readonly type: MetricType = 'histogram';
  public readonly labelNames: string[];
  public readonly buckets: number[];
  private values = new Map<string, HistogramEntry>();

  constructor(options: HistogramOptions) {
    this.name = sanitizeMetricName(options.name);
    this.help = options.help;
    this.labelNames = options.labelNames || [];
    this.buckets = (options.buckets || DEFAULT_HISTOGRAM_BUCKETS).slice().sort((a, b) => a - b);
  }

  public observe(labelsOrVal: Record<string, string | number> | number, value?: number): void {
    let labels: Record<string, string | number> = {};
    let obsVal: number;

    if (typeof labelsOrVal === 'number') {
      obsVal = labelsOrVal;
    } else {
      labels = labelsOrVal;
      obsVal = value ?? 0;
    }

    const key = labelsKey(labels);
    let entry = this.values.get(key);
    if (!entry) {
      entry = {
        labels,
        buckets: new Map<number, number>(),
        sum: 0,
        count: 0,
      };
      for (const b of this.buckets) {
        entry.buckets.set(b, 0);
      }
      this.values.set(key, entry);
    }

    entry.count += 1;
    entry.sum += obsVal;

    for (const b of this.buckets) {
      if (obsVal <= b) {
        entry.buckets.set(b, (entry.buckets.get(b) || 0) + 1);
      }
    }
  }

  public get(labels?: Record<string, string | number>): { count: number; sum: number } {
    const key = labelsKey(labels);
    const entry = this.values.get(key);
    return {
      count: entry?.count ?? 0,
      sum: entry?.sum ?? 0,
    };
  }

  public reset(): void {
    this.values.clear();
  }

  public serialize(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} ${this.type}`,
    ];

    if (this.values.size === 0) {
      for (const b of this.buckets) {
        lines.push(`${this.name}_bucket{le="${b}"} 0`);
      }
      lines.push(`${this.name}_bucket{le="+Inf"} 0`);
      lines.push(`${this.name}_sum 0`);
      lines.push(`${this.name}_count 0`);
      return lines.join('\n');
    }

    for (const entry of this.values.values()) {
      for (const b of this.buckets) {
        const bLabels = { ...entry.labels, le: String(b) };
        lines.push(`${this.name}_bucket${formatLabels(bLabels)} ${entry.buckets.get(b) || 0}`);
      }
      const infLabels = { ...entry.labels, le: '+Inf' };
      lines.push(`${this.name}_bucket${formatLabels(infLabels)} ${entry.count}`);
      lines.push(`${this.name}_sum${formatLabels(entry.labels)} ${Math.round(entry.sum * 1000000) / 1000000}`);
      lines.push(`${this.name}_count${formatLabels(entry.labels)} ${entry.count}`);
    }

    return lines.join('\n');
  }
}

export class PrometheusRegistry {
  private metricsMap = new Map<string, Counter | Gauge | Histogram>();

  public static readonly CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

  public registerCounter(name: string, help: string, labelNames?: string[]): Counter {
    if (this.metricsMap.has(name)) {
      return this.metricsMap.get(name) as Counter;
    }
    const counter = new Counter({ name, help, labelNames });
    this.metricsMap.set(name, counter);
    return counter;
  }

  public registerGauge(name: string, help: string, labelNames?: string[]): Gauge {
    if (this.metricsMap.has(name)) {
      return this.metricsMap.get(name) as Gauge;
    }
    const gauge = new Gauge({ name, help, labelNames });
    this.metricsMap.set(name, gauge);
    return gauge;
  }

  public registerHistogram(name: string, help: string, labelNames?: string[], buckets?: number[]): Histogram {
    if (this.metricsMap.has(name)) {
      return this.metricsMap.get(name) as Histogram;
    }
    const histogram = new Histogram({ name, help, labelNames, buckets });
    this.metricsMap.set(name, histogram);
    return histogram;
  }

  public getMetric<T = Counter | Gauge | Histogram>(name: string): T | undefined {
    return this.metricsMap.get(name) as T | undefined;
  }

  public metrics(): string {
    const outputs: string[] = [];
    for (const metric of this.metricsMap.values()) {
      outputs.push(metric.serialize());
    }
    return outputs.join('\n\n') + '\n';
  }

  public resetAll(): void {
    for (const metric of this.metricsMap.values()) {
      metric.reset();
    }
  }

  public clear(): void {
    this.metricsMap.clear();
  }
}

// Global default registry singleton
export const globalPrometheusRegistry = new PrometheusRegistry();
