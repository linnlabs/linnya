export type {
  RenderNodeSelectionGeometry,
  RenderNodeSelectionPoint,
  RenderNodeSelectionRect,
} from './definitions/renderNodeSelectionTypes';
export {
  collectRenderNodeSelectionGeometries,
  findRenderNodeSelectionGeometryAtPoint,
  type RenderNodeSelectionPredicate,
} from './functions/renderNodeSelectionGeometry';
export {
  applyMatrix,
  identityMatrix,
  invertMatrix,
  multiplyMatrix,
  normalizeRect,
  pointInRect,
  polygonBounds,
  rectFromPoints,
  rectToPolygon,
  rectsIntersect,
  rotateMatrix,
  translateMatrix,
  type RenderNodeSelectionMatrix,
} from './functions/selectionGeometry';
