import type { CanvasElementId, CanvasSnapshot } from '../../../../shared';

export interface CanvasProjectionContext {
  readonly name: string;
  /** 只含当前项目可访问文档的当前地址；不可访问的目标不能泄漏路径或标题。 */
  readonly documentPaths: ReadonlyMap<string, string>;
  readonly documentTitles: ReadonlyMap<string, string>;
}

export interface CanvasSelectionProjectionInput {
  readonly snapshot: CanvasSnapshot;
  readonly elementIds: readonly CanvasElementId[];
  readonly path: string;
  readonly context: CanvasProjectionContext;
  readonly format?: 'context' | 'markdown';
}
