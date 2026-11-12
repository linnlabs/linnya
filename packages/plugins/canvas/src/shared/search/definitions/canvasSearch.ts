import type { CanvasElementId, CanvasElement } from '../../model/definitions/canvasElement';
import type { CanvasTagNames } from '../../tags/definitions/canvasTags';
export interface CanvasSearchHit {
  readonly id: CanvasElementId;
  readonly type: CanvasElement['type'];
  readonly text: string;
}
export interface CanvasSearchContext {
  /** 仅含当前项目可访问的目标标题；缺失目标不能退回内部ID。 */
  readonly documentTitles: ReadonlyMap<string, string>;
  /** 卡片标签的当前名称；给出时可按“#标签名”或状态名搜到。 */
  readonly tags?: CanvasTagNames;
}
