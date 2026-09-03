import type * as HarfBuzzRuntimeModule from 'harfbuzzjs';
import { readHarfBuzzRuntimeLoader } from './harfbuzzRuntimeLoaderResolver.js';

export type HarfBuzzModule = typeof HarfBuzzRuntimeModule;

let harfbuzzModulePromise: Promise<HarfBuzzModule> | null = null;
let harfbuzzModule: HarfBuzzModule | null = null;

// Loader 是 CJS/ESM 格式桥，不依赖 Electron；Backend 与 standalone CLI 共用。
const harfbuzzRuntimeLoader = readHarfBuzzRuntimeLoader();

export function ensureHarfBuzzModule(): Promise<HarfBuzzModule> {
  if (harfbuzzModule != null) {
    return Promise.resolve(harfbuzzModule);
  }
  harfbuzzModulePromise ??= harfbuzzRuntimeLoader.loadHarfBuzz().then((module) => {
    harfbuzzModule = module;
    return module;
  });
  return harfbuzzModulePromise;
}

export function isHarfBuzzReady(): boolean {
  return harfbuzzModule != null;
}

export function getReadyHarfBuzzModule(): HarfBuzzModule {
  if (harfbuzzModule == null) {
    throw new Error('HarfBuzz module is not ready. Call ensureHarfBuzzModule() during bootstrap first.');
  }
  return harfbuzzModule;
}

export function resetHarfBuzzModuleForTests(): void {
  harfbuzzModulePromise = null;
  harfbuzzModule = null;
}
