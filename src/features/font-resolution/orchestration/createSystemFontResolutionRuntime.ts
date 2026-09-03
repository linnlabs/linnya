import { join } from 'node:path';
import type {
  FontFamilyCheckResult,
  FontFamilyListRequest,
  FontFamilyListResult,
} from '../definitions/fontCatalogQuery.js';
import { FontCatalog } from './FontCatalog.js';
import { FontCatalogQueryService } from './FontCatalogQueryService.js';
import {
  configureDefaultFontCatalogQueryService,
  resetDefaultFontCatalogQueryService,
} from './defaultFontCatalogQueryService.js';
import {
  configureDefaultFontResolutionService,
  resetDefaultFontResolutionService,
} from './defaultFontResolutionService.js';

export interface SystemFontResolutionRuntime {
  initialize(): Promise<void>;
  dispose(): void;
  checkFontFamily(family: string): Promise<FontFamilyCheckResult>;
  listFontFamilies(request: FontFamilyListRequest): Promise<FontFamilyListResult>;
}

/**
 * 为独立 backend 进程建立一份同时服务解析与查询的系统字体目录。
 * 完整 Linnya 主进程由 platform runtime effect 装配；standalone CLI 必须显式
 * 持有本生命周期，不能只创建查询目录后让排版继续读取未就绪的默认解析器。
 */
export function createSystemFontResolutionRuntime(options: {
  readonly runtimeDataDirectory: string;
}): SystemFontResolutionRuntime {
  return createSystemFontResolutionRuntimeFromCatalog(new FontCatalog({
    cacheFilePath: join(options.runtimeDataDirectory, 'font-resolution', 'font-catalog.json'),
  }));
}

/** 仅供同 feature 测试注入确定性 FontCatalog；不从 public index 导出。 */
export function createSystemFontResolutionRuntimeFromCatalog(
  catalog: FontCatalog,
): SystemFontResolutionRuntime {
  const queryService = new FontCatalogQueryService(catalog);
  let active = false;

  return {
    async initialize() {
      if (active) return;
      active = true;
      configureDefaultFontResolutionService({ catalog });
      configureDefaultFontCatalogQueryService({ catalog });
      await catalog.scan();
    },
    dispose() {
      if (!active) return;
      active = false;
      resetDefaultFontResolutionService();
      resetDefaultFontCatalogQueryService();
    },
    checkFontFamily: (family) => queryService.checkFamily(family),
    listFontFamilies: (request) => queryService.listFamilies(request),
  };
}
