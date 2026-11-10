import type { CanvasElementId, CanvasElement } from '../../model/definitions/canvasElement';
export interface CanvasSearchHit {
  readonly id: CanvasElementId;
  readonly type: CanvasElement['type'];
  readonly text: string;
}
export interface CanvasSearchContext {
  /** 仅含当前项目可访问的目标标题；缺失目标不能退回内部ID。 */
  readonly documentTitles: ReadonlyMap<string, string>;
}
