export type {
  GradientPaint,
  GradientStop,
  LinearGradientPaint,
  NoPaint,
  NormalizedPaintPoint,
  NormalizedPaintRadius,
  Paint,
  RadialGradientPaint,
  ShapeFillInput,
  ShapeStrokeStyle,
  SolidPaint,
  StrokePaint,
} from './definitions/paint';
export {
  asLinearGradientPaint,
  normalizeGradientAngle,
  normalizeGradientPaint,
  normalizePaint,
  normalizeShapeFillInput,
  normalizeStrokePaint,
  resolvePaintOpacity,
} from './functions/normalizePaint';

