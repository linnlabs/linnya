import { Logger } from '../../../shared/logger.js';
import { HeuristicMeasureAdapter } from '../adapters/HeuristicMeasureAdapter.js';
import type { FontFileLocator } from '../definitions/types.js';
import {
  configureDefaultTextMeasureService,
  resetDefaultTextMeasureService,
} from './defaultTextMeasureService.js';
import {
  collectRequiredGlyphCodePoints,
  resolveFont,
} from '../../font-resolution/index.js';
import { HarfBuzzClusterAdvanceProvider } from '../infrastructure/system/HarfBuzzClusterAdvanceProvider.js';
import { ensureHarfBuzzModule } from '../infrastructure/system/harfbuzzModule.js';
import { MeasurementCache } from '../infrastructure/browser-pretext/MeasurementCache.js';
import {
  MeasurementClient,
  type MeasurementFallbackInfo,
  type MeasurementWorkerManagerPort,
} from '../infrastructure/browser-pretext/MeasurementClient.js';

const logger = new Logger('DefaultTextMeasurementRuntime');
const FALLBACK_LOG_SAMPLE_RATE = 25;

let installedPrimaryKind: string | null = null;
let installedClusterAdvanceKind: string | null = null;

interface FallbackAggregate {
  total: number;
  bySourceKind: Map<MeasurementFallbackInfo['sourceKind'], number>;
}

function createFallbackObserver(): (info: MeasurementFallbackInfo) => void {
  const aggregate: FallbackAggregate = {
    total: 0,
    bySourceKind: new Map(),
  };

  return (info) => {
    aggregate.total += 1;
    aggregate.bySourceKind.set(
      info.sourceKind,
      (aggregate.bySourceKind.get(info.sourceKind) ?? 0) + 1,
    );

    if (aggregate.total % FALLBACK_LOG_SAMPLE_RATE !== 0) {
      return;
    }

    const bySourceKind = [...aggregate.bySourceKind.entries()]
      .map(([sourceKind, count]) => `${sourceKind}:${count}`)
      .join(',');
    logger.warn(
      'measurement.fallback summary ' +
      `total=${aggregate.total} bySourceKind=${bySourceKind} ` +
      `lastSourceKind=${info.sourceKind} lastTextLength=${info.textLength} ` +
      `lastFont="${info.fontFamily ?? ''}" lastFontSizePt=${info.fontSizePt} ` +
      `lastWrap=${info.wrap} lastWidthInches=${info.widthInches.toFixed(3)} ` +
      `cacheHitRate=${info.hitRate.toFixed(3)} cacheMisses=${info.cacheMisses}`,
    );
  };
}

async function createHarfBuzzClusterAdvanceProvider(
  useHarfBuzz: boolean,
): Promise<HarfBuzzClusterAdvanceProvider | null> {
  if (!useHarfBuzz) {
    return null;
  }
  try {
    await ensureHarfBuzzModule();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`measurement.cluster_advance.configure source=pretext reason="harfbuzz unavailable: ${message}"`);
    return null;
  }

  return new HarfBuzzClusterAdvanceProvider({
    fontFileLocator: createFontFileLocator(),
  });
}

function createFontFileLocator(): FontFileLocator {
  return {
    locate: (request) => {
      const resolved = resolveFont({
        family: request.family,
        bold: request.bold,
        italic: request.italic,
        script: request.script,
        requiredCodePoints: collectRequiredGlyphCodePoints(request.text),
      });
      if (!resolved.catalogReady || resolved.resolved == null) {
        return undefined;
      }
      return {
        filePath: resolved.resolved.filePath,
        faceIndex: resolved.resolved.faceIndex,
        postscriptName: resolved.resolved.postscriptName,
      };
    },
  };
}

function logClusterAdvanceConfiguration(kind: string | null): void {
  if (installedClusterAdvanceKind === kind) {
    return;
  }
  logger.info(`measurement.cluster_advance.configure source=${kind ?? 'pretext'}`);
  installedClusterAdvanceKind = kind;
}

export interface DefaultTextMeasurementRuntimeOptions {
  readonly worker: MeasurementWorkerManagerPort & {
    readonly availability:
      | { readonly available: true }
      | { readonly available: false; readonly reason: string };
  };
  readonly useBrowserPretext: boolean;
  readonly useHarfBuzz: boolean;
}

export async function configureDefaultTextMeasurementRuntime(
  options: DefaultTextMeasurementRuntimeOptions,
): Promise<void> {
  const fallback = new HeuristicMeasureAdapter();
  const clusterAdvanceProvider = await createHarfBuzzClusterAdvanceProvider(options.useHarfBuzz);
  logClusterAdvanceConfiguration(clusterAdvanceProvider?.kind ?? null);

  if (!options.useBrowserPretext) {
    configureDefaultTextMeasureService({
      primary: fallback,
      fallback,
      clusterAdvanceProvider,
    });
    if (installedPrimaryKind !== fallback.kind) {
      logger.info('measurement.service.configure enabled=false primary=heuristic');
      installedPrimaryKind = fallback.kind;
    }
    return;
  }

  if (!options.worker.availability.available) {
    configureDefaultTextMeasureService({
      primary: fallback,
      fallback,
      clusterAdvanceProvider,
    });
    if (installedPrimaryKind !== fallback.kind) {
      logger.warn(
        `measurement.service.configure force_disabled reason="${options.worker.availability.reason}" ` +
        '(运行 npm run build:measurement-worker && npm run build:measurement-preload)',
      );
      installedPrimaryKind = fallback.kind;
    }
    return;
  }

  const client = new MeasurementClient({
    cache: new MeasurementCache(),
    fallback,
    workerManager: options.worker,
    onFallback: createFallbackObserver(),
  });
  configureDefaultTextMeasureService({
    primary: client,
    fallback,
    clusterAdvanceProvider,
  });
  if (installedPrimaryKind !== client.kind) {
    logger.info('measurement.service.configure enabled=true primary=main-pretext-cached');
    installedPrimaryKind = client.kind;
  }
}

export function resetDefaultTextMeasurementRuntime(): void {
  resetDefaultTextMeasureService();
  installedPrimaryKind = null;
  installedClusterAdvanceKind = null;
}

export function getDefaultTextMeasurementRuntimeStateForTests(): string | null {
  return installedPrimaryKind;
}
