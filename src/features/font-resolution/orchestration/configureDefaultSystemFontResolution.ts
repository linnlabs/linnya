import path from 'node:path';
import { Logger } from '../../../shared/logger.js';
import { readInstalledRuntimePathRoots } from '../../../shared/runtime-paths';
import {
  configureDefaultFontCatalogQueryService,
  configureDefaultFontResolutionService,
  FontCatalog,
  resetDefaultFontCatalogQueryService,
  resetDefaultFontResolutionService,
} from '../index.js';

const logger = new Logger('SystemFontResolution');

let installedCatalogCachePath: string | null = null;

export function configureDefaultSystemFontResolution(): void {
  const runtimePathRoots = readInstalledRuntimePathRoots();
  if (!runtimePathRoots) {
    throw new Error('System font resolution 缺少 App owner 安装的 Runtime path roots');
  }

  const cacheFilePath = path.join(
    runtimePathRoots.appDataRoot,
    'font-resolution',
    'font-catalog.json',
  );
  const catalog = new FontCatalog({ cacheFilePath });
  configureDefaultFontResolutionService({ catalog });
  configureDefaultFontCatalogQueryService({ catalog });
  installedCatalogCachePath = cacheFilePath;

  void catalog.scan()
    .then(() => {
      logger.info(`font_resolution.catalog.ready fonts=${catalog.allFonts().length}`);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`font_resolution.catalog.scan_failed message="${message}"`);
    });
}

export function resetDefaultSystemFontResolution(): void {
  resetDefaultFontResolutionService();
  resetDefaultFontCatalogQueryService();
  installedCatalogCachePath = null;
}

export function getDefaultSystemFontResolutionRuntimeStateForTests(): string | null {
  return installedCatalogCachePath;
}
