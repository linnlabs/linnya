import { join } from 'node:path';

import type {
  FontFamilyCheckResult,
  FontFamilyListRequest,
  FontFamilyListResult,
} from '../definitions/fontCatalogQuery.js';
import { FontCatalog } from './FontCatalog.js';
import { FontCatalogQueryService } from './FontCatalogQueryService.js';

export interface SystemFontCatalogQueryRuntime {
  scan(): Promise<void>;
  checkFontFamily(family: string): Promise<FontFamilyCheckResult>;
  listFontFamilies(request: FontFamilyListRequest): Promise<FontFamilyListResult>;
}

/**
 * 为 standalone backend process 建立平台字体查询 runtime。
 * 普通插件命令应消费已配置的默认查询函数，不应自行创建第二份 catalog。
 */
export function createSystemFontCatalogQueryRuntime(options: {
  readonly runtimeDataDirectory: string;
}): SystemFontCatalogQueryRuntime {
  const catalog = new FontCatalog({
    cacheFilePath: join(options.runtimeDataDirectory, 'font-resolution', 'font-catalog.json'),
  });
  const queryService = new FontCatalogQueryService(catalog);
  return {
    scan: () => catalog.scan(),
    checkFontFamily: (family) => queryService.checkFamily(family),
    listFontFamilies: (request) => queryService.listFamilies(request),
  };
}
