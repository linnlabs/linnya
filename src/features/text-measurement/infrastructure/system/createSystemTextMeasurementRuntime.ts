import { Logger } from '../../../../shared/logger.js';
import {
  configureDefaultTextMeasureService,
  resetDefaultTextMeasureService,
} from '../../orchestration/defaultTextMeasureService.js';
import { HeuristicMeasureAdapter } from '../../adapters/HeuristicMeasureAdapter.js';
import type {
  FontFileLocator,
  TextMeasureClusterAdvanceProvider,
} from '../../definitions/types.js';
import {
  collectRequiredGlyphCodePoints,
  resolveFont,
} from '../../../font-resolution/index.js';
import { HarfBuzzClusterAdvanceProvider } from './HarfBuzzClusterAdvanceProvider.js';
import { ensureHarfBuzzModule } from './harfbuzzModule.js';

const logger = new Logger('SystemTextMeasurementRuntime');

export interface SystemTextMeasurementRuntime {
  initialize(): Promise<void>;
  dispose(): void;
}

type ClusterAdvanceProviderFactory = () => Promise<TextMeasureClusterAdvanceProvider | null>;

/**
 * standalone backend 不启动完整 Linnya measurement worker，只装配确定性的系统
 * 字体 HarfBuzz cluster advance；不可用时如实保留 heuristic provenance。
 */
export function createSystemTextMeasurementRuntime(
  options: { readonly useHarfBuzz?: boolean } = {},
): SystemTextMeasurementRuntime {
  const useHarfBuzz = options.useHarfBuzz
    ?? process.env.MEASUREMENT_USE_HARFBUZZ !== 'false';
  return createSystemTextMeasurementRuntimeWithProviderFactory(
    () => createSystemHarfBuzzClusterAdvanceProvider(useHarfBuzz),
  );
}

/** 仅供本 adapter 测试注入 provider factory；不从 plugin SDK 导出。 */
export function createSystemTextMeasurementRuntimeWithProviderFactory(
  createProvider: ClusterAdvanceProviderFactory,
): SystemTextMeasurementRuntime {
  let active = false;
  return {
    async initialize() {
      if (active) return;
      const fallback = new HeuristicMeasureAdapter();
      const clusterAdvanceProvider = await createProvider();
      configureDefaultTextMeasureService({
        primary: fallback,
        fallback,
        clusterAdvanceProvider,
      });
      active = true;
      logger.info(
        `measurement.system_runtime.ready clusterAdvance=${clusterAdvanceProvider?.kind ?? 'heuristic'}`,
      );
    },
    dispose() {
      if (!active) return;
      active = false;
      resetDefaultTextMeasureService();
    },
  };
}

async function createSystemHarfBuzzClusterAdvanceProvider(
  useHarfBuzz: boolean,
): Promise<TextMeasureClusterAdvanceProvider | null> {
  if (!useHarfBuzz) {
    return null;
  }
  try {
    await ensureHarfBuzzModule();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`measurement.system_runtime.harfbuzz_unavailable message="${message}"`);
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
