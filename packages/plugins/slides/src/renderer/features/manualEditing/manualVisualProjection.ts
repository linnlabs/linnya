/** Konva 等只读渲染入口使用的窄公开合同；不得从这里带入 store、orchestration 或 UI 适配。 */
export type {
  ManualEditableTarget,
  ManualEditingVisualPreview,
} from './definitions/manualEditingTypes';
export {
  projectManualVisualPreviewToRenderNode,
  projectManualVisualPreviewToSelectionPolygon,
} from './functions/manualVisualPreview';
