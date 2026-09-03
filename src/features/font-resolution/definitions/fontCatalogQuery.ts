import type { ScriptClass } from './types.js';

export type FontCatalogState = 'idle' | 'scanning' | 'ready' | 'failed';
export type FontFamilyStyle = 'regular' | 'bold' | 'italic';

/** 面向上层设计能力的字体族事实；有意不包含字体文件路径与 face index。 */
export interface FontFamilyCandidate {
  readonly family: string;
  readonly scripts: readonly ScriptClass[];
  readonly styles: readonly FontFamilyStyle[];
  readonly monospace: boolean;
}

export interface FontFamilyCheckResult {
  readonly requestedFamily: string;
  readonly installed: boolean;
  readonly match?: FontFamilyCandidate;
}

export interface FontFamilyListRequest {
  readonly script: ScriptClass;
  readonly offset: number;
  readonly limit: number;
}

export interface FontFamilyListResult {
  readonly script: ScriptClass;
  readonly offset: number;
  readonly limit: number;
  readonly total: number;
  readonly hasMore: boolean;
  readonly families: readonly FontFamilyCandidate[];
}

export class FontCatalogUnavailableError extends Error {
  readonly name = 'FontCatalogUnavailableError';
  readonly code = 'font.catalog_unavailable' as const;

  constructor() {
    super('System font catalog is unavailable');
  }
}
