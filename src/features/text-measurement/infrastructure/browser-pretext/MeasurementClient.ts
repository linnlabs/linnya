import { Logger } from '../../../../shared/logger.js';
import type {
  ClusterAdvanceMeasureResult,
  NormalizedClusterAdvanceRequest,
  NormalizedTextMeasureInput,
  TextMeasureAdvanceSource,
  TextMeasureAdapter,
  TextMeasureResult,
} from '../../index.js';
import { isMeasurementBatchError, type MeasurementBatchResponse } from './protocol.js';
import { createMeasurementCacheKey, MeasurementCache } from './MeasurementCache.js';

const DEFAULT_CACHE_LOG_SAMPLE_RATE = 100;
const DEFAULT_CACHE_MISS_WARN_SAMPLE_RATE = 10;
const DEFAULT_LOW_HIT_RATE_THRESHOLD = 0.3;
const DEFAULT_LOW_HIT_RATE_MIN_SAMPLES = 50;
const DEFAULT_CLUSTER_ADVANCE_CACHE_MAX_SIZE = 4096;

export interface MeasurementWorkerManagerPort {
  measureBatch(inputs: readonly NormalizedTextMeasureInput[]): Promise<MeasurementBatchResponse>;
  measureClusterAdvancesBatch?(
    requests: readonly NormalizedClusterAdvanceRequest[],
  ): Promise<MeasurementBatchResponse>;
  touch(): void;
}

export interface MeasurementFallbackInfo {
  sourceKind: NormalizedTextMeasureInput['sourceKind'];
  textLength: number;
  fontFamily?: string;
  fontSizePt: number;
  bold: boolean;
  italic: boolean;
  wrap: NormalizedTextMeasureInput['box']['wrap'];
  widthInches: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: number;
}

export interface MeasurementClientOptions {
  cache?: MeasurementCache;
  fallback: TextMeasureAdapter;
  /** App composition 提供稳定端口；BrowserWindow/IPC 不能进入本 feature。 */
  workerManager: MeasurementWorkerManagerPort;
  logger?: Pick<Logger, 'info' | 'warn'>;
  /** 同步 cache miss 退回 fallback 时的结构化观测点。 */
  onFallback?: (info: MeasurementFallbackInfo) => void;
  cacheLogSampleRate?: number;
  /**
   * 同步 measure 发生 cache miss 时的告警采样频率。
   * miss 本身意味着本次调用无法使用真实 worker 测量，只能同步退到 fallback；
   * 这里保留采样告警，方便发现遗漏 prewarm 或 input key 不一致。
   */
  cacheMissWarnSampleRate?: number;
  /**
   * 命中率低于该阈值时，每个 sample 周期会输出一条 warn，便于快速发现
   * "prewarm 与 measure key 不一致 → 100% miss"这类回归（修 H2）。
   * 默认 0.3。
   */
  lowHitRateThreshold?: number;
  /** 命中率告警的最小样本数，避免冷启动噪声。默认 50。 */
  lowHitRateMinSamples?: number;
  /** cluster advance 同步缓存容量。长会话内按 LRU 淘汰，避免字体/字号组合无限增长。 */
  clusterAdvanceCacheMaxSize?: number;
}

export class MeasurementClient implements TextMeasureAdapter {
  readonly kind = 'main-pretext-cached';

  private readonly cache: MeasurementCache;
  private readonly fallback: TextMeasureAdapter;
  private readonly workerManagerProvider: () => MeasurementWorkerManagerPort;
  private readonly logger: Pick<Logger, 'info' | 'warn'>;
  private readonly onFallback?: (info: MeasurementFallbackInfo) => void;
  private readonly cacheLogSampleRate: number;
  private readonly cacheMissWarnSampleRate: number;
  private readonly lowHitRateThreshold: number;
  private readonly lowHitRateMinSamples: number;
  private readonly clusterAdvanceCacheMaxSize: number;
  private readonly clusterAdvanceCache = new Map<string, number[]>();
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(options: MeasurementClientOptions) {
    this.cache = options.cache ?? new MeasurementCache();
    this.fallback = options.fallback;
    const fixedManager = options.workerManager;
    this.workerManagerProvider = () => fixedManager;
    this.logger = options.logger ?? new Logger('MeasurementClient');
    this.onFallback = options.onFallback;
    this.cacheLogSampleRate = Math.max(1, options.cacheLogSampleRate ?? DEFAULT_CACHE_LOG_SAMPLE_RATE);
    this.cacheMissWarnSampleRate = Math.max(1, options.cacheMissWarnSampleRate ?? DEFAULT_CACHE_MISS_WARN_SAMPLE_RATE);
    this.lowHitRateThreshold = Math.max(0, Math.min(1, options.lowHitRateThreshold ?? DEFAULT_LOW_HIT_RATE_THRESHOLD));
    this.lowHitRateMinSamples = Math.max(1, options.lowHitRateMinSamples ?? DEFAULT_LOW_HIT_RATE_MIN_SAMPLES);
    this.clusterAdvanceCacheMaxSize = Math.max(1, options.clusterAdvanceCacheMaxSize ?? DEFAULT_CLUSTER_ADVANCE_CACHE_MAX_SIZE);
  }

  getStats(): { hits: number; misses: number; hitRate: number } {
    const total = this.cacheHits + this.cacheMisses;
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: total === 0 ? 0 : this.cacheHits / total,
    };
  }

  async prewarm(inputs: readonly NormalizedTextMeasureInput[]): Promise<void> {
    const misses = this.collectCacheMisses(inputs);
    if (misses.length === 0) {
      return;
    }

    const startedAt = Date.now();
    const workerManager = this.workerManagerProvider();
    try {
      const response = await workerManager.measureBatch(misses);
      let fellBackCount = 0;
      const responseCount = Math.min(misses.length, response.results.length);

      for (let index = 0; index < responseCount; index += 1) {
        const result = response.results[index];
        const input = misses[index];
        if (result == null || input == null) {
          continue;
        }
        if (isMeasurementBatchError(result)) {
          fellBackCount += 1;
          continue;
        }
        this.cache.set(input, result);
      }

      if (response.results.length < misses.length) {
        fellBackCount += misses.length - response.results.length;
        this.logger.warn(
          `measurement.batch incomplete expected=${misses.length} actual=${response.results.length}`,
        );
      }

      workerManager.touch();
      this.logger.info(
        `measurement.batch size=${misses.length} durationMs=${Date.now() - startedAt} fellBackCount=${fellBackCount}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `measurement.batch failed size=${misses.length} durationMs=${Date.now() - startedAt} reason=${message}`,
      );
    }
  }

  async prewarmClusterAdvances(requests: readonly NormalizedClusterAdvanceRequest[]): Promise<void> {
    const misses = this.collectClusterAdvanceCacheMisses(requests);
    if (misses.length === 0) {
      return;
    }

    const startedAt = Date.now();
    const workerManager = this.workerManagerProvider();
    if (workerManager.measureClusterAdvancesBatch == null) {
      this.logger.warn('measurement.cluster.batch unavailable reason="worker manager does not support cluster advances"');
      return;
    }

    try {
      const response = await workerManager.measureClusterAdvancesBatch(misses);
      let fellBackCount = 0;
      const clusterResults = response.clusterResults ?? [];
      const responseCount = Math.min(misses.length, clusterResults.length);

      for (let index = 0; index < responseCount; index += 1) {
        const result = clusterResults[index];
        const request = misses[index];
        if (result == null || request == null) {
          continue;
        }
        if (isMeasurementBatchError(result)) {
          fellBackCount += 1;
          continue;
        }
        this.setClusterAdvanceCache(request, result.advances);
      }

      if (clusterResults.length < misses.length) {
        fellBackCount += misses.length - clusterResults.length;
        this.logger.warn(
          `measurement.cluster.batch incomplete expected=${misses.length} actual=${clusterResults.length}`,
        );
      }

      workerManager.touch();
      this.logger.info(
        `measurement.cluster.batch size=${misses.length} durationMs=${Date.now() - startedAt} fellBackCount=${fellBackCount}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `measurement.cluster.batch failed size=${misses.length} durationMs=${Date.now() - startedAt} reason=${message}`,
      );
    }
  }

  measure(input: NormalizedTextMeasureInput): TextMeasureResult {
    const cached = this.cache.get(input);
    if (cached != null) {
      this.recordCacheStat(true);
      return cached;
    }

    this.recordCacheStat(false);
    this.recordCacheMissWarning(input);
    this.recordFallback(input);
    const fallbackResult = this.fallback.measure(input);
    return {
      ...fallbackResult,
      usedFallback: true,
      warnings: [
        ...fallbackResult.warnings,
        'MeasurementClient: cache miss, fell back to heuristic',
      ],
    };
  }

  measureClusterAdvances(request: NormalizedClusterAdvanceRequest): number[] {
    return this.measureClusterAdvancesWithSource(request).advances;
  }

  measureClusterAdvancesWithSource(request: NormalizedClusterAdvanceRequest): ClusterAdvanceMeasureResult {
    const key = createClusterAdvanceCacheKey(request);
    const cached = this.clusterAdvanceCache.get(key);
    if (cached != null) {
      this.clusterAdvanceCache.delete(key);
      this.clusterAdvanceCache.set(key, cached);
      return {
        advances: [...cached],
        source: 'pretext',
      };
    }

    this.logger.warn(
      'measurement.cluster.cache miss_fallback ' +
      `sourceKind=${request.sourceKind} fontSizePt=${request.style.fontSizePt} ` +
      `clusterCount=${request.clusters.length}`,
    );
    if (this.fallback.measureClusterAdvancesWithSource != null) {
      return this.fallback.measureClusterAdvancesWithSource(request);
    }
    if (this.fallback.measureClusterAdvances != null) {
      return {
        advances: this.fallback.measureClusterAdvances(request),
        source: resolveAdapterAdvanceSource(this.fallback.kind),
      };
    }
    throw new Error('MeasurementClient fallback adapter does not support cluster advances');
  }

  private setClusterAdvanceCache(request: NormalizedClusterAdvanceRequest, advances: readonly number[]): void {
    const key = createClusterAdvanceCacheKey(request);
    if (this.clusterAdvanceCache.has(key)) {
      this.clusterAdvanceCache.delete(key);
    }
    this.clusterAdvanceCache.set(key, [...advances]);
    while (this.clusterAdvanceCache.size > this.clusterAdvanceCacheMaxSize) {
      const oldestKey = this.clusterAdvanceCache.keys().next().value;
      if (oldestKey == null) {
        return;
      }
      this.clusterAdvanceCache.delete(oldestKey);
    }
  }

  private recordCacheMissWarning(input: NormalizedTextMeasureInput): void {
    if (this.cacheMisses % this.cacheMissWarnSampleRate !== 0) {
      return;
    }

    this.logger.warn(
      'measurement.cache miss_fallback ' +
      `misses=${this.cacheMisses} sourceKind=${input.sourceKind} ` +
      `fontSizePt=${input.style.fontSizePt} wrap=${input.box.wrap} ` +
      `widthInches=${input.box.widthInches.toFixed(3)}`,
    );
  }

  private recordFallback(input: NormalizedTextMeasureInput): void {
    if (!this.onFallback) {
      return;
    }

    const stats = this.getStats();
    this.onFallback({
      sourceKind: input.sourceKind,
      textLength: input.paragraphs.reduce((sum, paragraph) => sum + paragraph.text.length, 0),
      fontFamily: input.style.fontFamily,
      fontSizePt: input.style.fontSizePt,
      bold: input.style.bold,
      italic: input.style.italic,
      wrap: input.box.wrap,
      widthInches: input.box.widthInches,
      cacheHits: stats.hits,
      cacheMisses: stats.misses,
      hitRate: stats.hitRate,
    });
  }

  private collectCacheMisses(inputs: readonly NormalizedTextMeasureInput[]): NormalizedTextMeasureInput[] {
    const dedupedMisses = new Map<string, NormalizedTextMeasureInput>();
    for (const input of inputs) {
      if (this.cache.has(input)) {
        continue;
      }
      dedupedMisses.set(createMeasurementCacheKey(input), input);
    }
    return [...dedupedMisses.values()];
  }

  private collectClusterAdvanceCacheMisses(
    requests: readonly NormalizedClusterAdvanceRequest[],
  ): NormalizedClusterAdvanceRequest[] {
    const dedupedMisses = new Map<string, NormalizedClusterAdvanceRequest>();
    for (const request of requests) {
      const key = createClusterAdvanceCacheKey(request);
      if (this.clusterAdvanceCache.has(key)) {
        continue;
      }
      dedupedMisses.set(key, request);
    }
    return [...dedupedMisses.values()];
  }

  private recordCacheStat(hit: boolean): void {
    if (hit) {
      this.cacheHits += 1;
    } else {
      this.cacheMisses += 1;
    }

    const total = this.cacheHits + this.cacheMisses;
    if (total % this.cacheLogSampleRate !== 0) {
      return;
    }

    const hitRate = this.cacheHits / total;
    this.logger.info(
      `measurement.cache hits=${this.cacheHits} misses=${this.cacheMisses} hitRate=${hitRate.toFixed(3)}`,
    );
    if (total >= this.lowHitRateMinSamples && hitRate < this.lowHitRateThreshold) {
      this.logger.warn(
        `measurement.cache low_hit_rate hitRate=${hitRate.toFixed(3)} threshold=${this.lowHitRateThreshold} ` +
        `samples=${total} (检查 prewarm builder 与 measure builder 是否一致)`,
      );
    }
  }
}

function resolveAdapterAdvanceSource(adapterKind: string): TextMeasureAdvanceSource {
  if (adapterKind === 'browser-pretext' || adapterKind === 'main-pretext-cached') {
    return 'pretext';
  }
  if (adapterKind === 'harfbuzz') {
    return 'harfbuzz';
  }
  return 'heuristic';
}

function createClusterAdvanceCacheKey(request: NormalizedClusterAdvanceRequest): string {
  return JSON.stringify({
    c: request.clusters,
    s: [
      request.style.fontSizePt,
      request.style.fontFamily,
      request.style.bold,
      request.style.italic,
      request.style.lineHeightMultiplier,
      request.style.letterSpacingPt,
    ],
    sourceKind: request.sourceKind,
  });
}
