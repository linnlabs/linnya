export * from './model/definitions/canvasElement';
export * from './model/functions/readCanvasContent';
export * from './model/functions/canvasCardSizing';
export * from './history/functions/canvasHistorySession';
export {
  readCanvasCardPalette,
  readCanvasCardCssPalette,
} from './appearance/functions/readCanvasCardPalette';
export type {
  CanvasCardPalette,
  CanvasCardCssPalette,
} from './appearance/definitions/canvasCardPalette';
export type * from './geometry/definitions/canvasGeometry';
export {
  canvasBounds,
  canvasRectanglesOverlap,
  canvasScreenToWorld,
  canvasWorldToScreen,
} from './geometry/functions/canvasGeometry';
export {
  createCanvasEdgeLayout,
  layoutCanvasEdges,
  resolveCanvasEdgeGeometry,
} from './geometry/functions/canvasEdgeGeometry';
export type { CanvasEdgeGeometry, CanvasEdgeSide } from './geometry/functions/canvasEdgeGeometry';

export {
  CANVAS_PLUGIN_ID,
  CANVAS_DOCUMENT_TYPE,
  CANVAS_FILE_EXTENSION,
  canvasManifest,
  canvasPluginMeta,
} from './definitions/pluginMeta';
export * from './changeset/definitions/canvasCommands';
export * from './changeset/definitions/canvasSynchronization';
export {
  CanvasLayoutOptionsSchema,
  CanvasLayoutDiagnosticSchema,
  CanvasLayoutResultSchema,
  CanvasLayoutComputationSchema,
} from './layout/definitions/canvasLayout';
export type {
  CanvasLayoutOptions,
  CanvasLayoutRequest,
  CanvasLayoutDiagnostic,
  CanvasLayoutResult,
  CanvasLayoutComputation,
} from './layout/definitions/canvasLayout';
export type { CanvasComputationRuntime } from './computation/definitions/canvasComputation';

export * from './history/definitions/canvasUserHistory';
export * from './agentChanges/definitions/canvasAgentChanges';
export * from './images/definitions/canvasImageRequests';
export * from './failures/definitions/canvasUserFailure';
export * from './context/definitions/canvasSelectionContext';
export {
  searchCanvasElements,
  readCanvasElementSearchText,
} from './search/functions/searchCanvasElements';
export type { CanvasSearchHit, CanvasSearchContext } from './search/definitions/canvasSearch';
export { orderCanvasCardsForReading } from './reading/functions/orderCanvasCardsForReading';
export {
  readCanvasCardComponent,
  readCanvasCardConnections,
} from './reading/functions/canvasCardConnections';
export type { CanvasCardConnection } from './reading/functions/canvasCardConnections';
export { CanvasCheckReportSchema } from './query/definitions/canvasCheck';
export type { CanvasCheckReport } from './query/definitions/canvasCheck';
export {
  CanvasArrangeRequestSchema,
  CanvasArrangeResultSchema,
  CanvasCancelArrangementRequestSchema,
} from './layout/definitions/canvasLayout';
export type { CanvasArrangeRequest } from './layout/definitions/canvasLayout';

export { CanvasVersionBudgetStatusSchema } from './history/definitions/canvasVersionBudget';
export type { CanvasVersionBudgetStatus } from './history/definitions/canvasVersionBudget';
export * from './history/definitions/canvasVersionRequests';

export {
  readCanvasLinePalette,
  type CanvasLinePalette,
} from './appearance/functions/readCanvasLinePalette';

export { canvasTextPrefix, canvasTextGraphemes } from './model/functions/canvasTextGraphemes';
