export {
  DEFAULT_SHAPE_GEOMETRY,
  MAX_SHAPE_PATH_COMMANDS,
  MAX_SHAPE_POLYGON_POINTS,
  PRESET_SHAPE_NAMES,
} from './definitions/shapeGeometry';
export type {
  ParallelogramGeometrySpec,
  PathGeometrySpec,
  PolygonGeometrySpec,
  PresetShapeGeometrySpec,
  PresetShapeName,
  RegularPolygonGeometrySpec,
  ResolvedPathShapeGeometry,
  ResolvedPresetShapeGeometry,
  ResolvedShapeGeometry,
  ShapeGeometrySpec,
  ShapePathCommand,
  ShapePoint,
  ShapeViewBox,
  TrapezoidGeometrySpec,
} from './definitions/shapeGeometry';
export {
  ShapeGeometryError,
  isPresetShapeName,
  parseShapeGeometrySpec,
  resolvePresetShapePath,
  resolveShapeGeometry,
  serializeShapePath,
  shapePathToPointArray,
} from './functions/shapeGeometry';
