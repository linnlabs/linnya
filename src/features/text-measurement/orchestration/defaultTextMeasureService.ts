import { HeuristicMeasureAdapter } from '../adapters/HeuristicMeasureAdapter.js';
import { defaultTextMeasureService } from '@linnya/text-measurement-core';
import type { TextMeasureAdapter, TextMeasureClusterAdvanceProvider } from '../definitions/types.js';

function detectEnvironment(): 'electron-renderer' | 'node' {
  if (typeof process !== 'undefined' && process.versions?.electron && process.type !== 'browser') {
    return 'electron-renderer';
  }
  return 'node';
}

/**
 * BrowserPretextAdapter 依赖 ESM-only 的 @chenglou/pretext，主进程 CJS bundle
 * 一旦 top-level import 它，加载阶段就会 throw "Cannot use import statement
 * outside a module"。所以这里**懒加载**：仅在确定是 renderer 环境时才 require。
 *
 * 主进程的 measurement worker 路径走 worker-entry.ts（platform=browser bundle），
 * 不经过这里，不受影响。
 */
function tryCreateBrowserPretextAdapter(): TextMeasureAdapter | null {
  if (detectEnvironment() !== 'electron-renderer') {
    return null;
  }
  try {
    const { BrowserPretextAdapter } = require('../adapters/BrowserPretextAdapter.js') as {
      BrowserPretextAdapter: new () => TextMeasureAdapter;
    };
    return new BrowserPretextAdapter();
  } catch {
    return null;
  }
}

function createEnvironmentDefaults(): {
  primary: TextMeasureAdapter;
  fallback: TextMeasureAdapter;
} {
  const heuristic = new HeuristicMeasureAdapter();
  const browserAdapter = tryCreateBrowserPretextAdapter();
  if (browserAdapter != null) {
    return {
      primary: browserAdapter,
      fallback: heuristic,
    };
  }
  return {
    primary: heuristic,
    fallback: heuristic,
  };
}

const environmentDefaults = createEnvironmentDefaults();
defaultTextMeasureService.configureAdapters({
  ...environmentDefaults,
  clusterAdvanceProvider: null,
});

export { defaultTextMeasureService };

export function configureDefaultTextMeasureService(options: {
  primary?: TextMeasureAdapter;
  fallback?: TextMeasureAdapter;
  clusterAdvanceProvider?: TextMeasureClusterAdvanceProvider | null;
}): void {
  defaultTextMeasureService.configureAdapters(options);
}

export function resetDefaultTextMeasureService(): void {
  defaultTextMeasureService.configureAdapters({
    ...environmentDefaults,
    clusterAdvanceProvider: null,
  });
}

export function resetDefaultTextMeasureServiceForTests(): void {
  resetDefaultTextMeasureService();
}
