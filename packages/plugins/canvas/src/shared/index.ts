export * from './model/definitions/canvasElement';
export * from './model/functions/readCanvasContent';
export type * from './geometry/definitions/canvasGeometry';
export { canvasBounds, canvasRectanglesOverlap, canvasScreenToWorld, canvasWorldToScreen } from './geometry/functions/canvasGeometry';
export { layoutCanvasEdges, resolveCanvasEdgeGeometry } from './geometry/functions/canvasEdgeGeometry';
export type { CanvasEdgeGeometry, CanvasEdgeSide } from './geometry/functions/canvasEdgeGeometry';

export { CANVAS_PLUGIN_ID, CANVAS_DOCUMENT_TYPE, CANVAS_FILE_EXTENSION, canvasManifest, canvasPluginMeta } from './definitions/pluginMeta';
export * from './changeset/definitions/canvasCommands';
export * from './changeset/definitions/canvasSynchronization';
export { CanvasLayoutOptionsSchema } from './layout/definitions/canvasLayout';
export type { CanvasLayoutOptions, CanvasLayoutRequest, CanvasLayoutDiagnostic, CanvasLayoutResult, CanvasLayoutRuntime } from './layout/definitions/canvasLayout';

export * from './history/definitions/canvasUserHistory';
export * from './agentChanges/definitions/canvasAgentChanges';
export { searchCanvasElements } from './search/functions/searchCanvasElements';
export type { CanvasSearchHit, CanvasSearchContext } from './search/definitions/canvasSearch';
