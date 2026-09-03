import {
  BRUSH_ARTWORK_BRUSHES,
  BRUSH_ARTWORK_FIELDS,
  BRUSH_ARTWORK_LIMITS,
  BRUSH_ARTWORK_QUALITIES,
  type BrushArtworkBrush,
  type BrushArtworkField,
  type BrushArtworkFill,
  type BrushArtworkHatch,
  type BrushArtworkIntent,
  type BrushArtworkLayer,
  type BrushArtworkMark,
  type BrushArtworkPoint,
  type BrushArtworkPosition,
  type BrushArtworkQuality,
  type BrushArtworkRenderErrorCode,
  type BrushArtworkRenderFailure,
  type BrushArtworkRenderRequest,
  type BrushArtworkRenderResult,
  type BrushArtworkRenderSuccess,
  type BrushArtworkSourceRef,
  type BrushArtworkStroke,
} from '../definitions/brushArtwork';

const DPI_BY_QUALITY: Readonly<Record<BrushArtworkQuality, number>> = {
  draft: 96,
  standard: 144,
  high: 216,
};
const MAX_DIMENSION_PX = 4096;
const MAX_PIXELS = 12_000_000;
const HEX_COLOR = /^#[0-9A-F]{6}$/u;

export function normalizeBrushArtworkIntent(value: unknown): BrushArtworkIntent {
  if (!isRecord(value)) throw new Error('Brush artwork intent must be an object.');
  if (!hasOnlyKeys(value, ['kind', 'seed', 'backgroundColor', 'quality', 'layers'])) {
    throw new Error('Brush artwork intent contains unsupported fields.');
  }
  if (value.kind != null && value.kind !== 'brush_artwork') {
    throw new Error('Brush artwork source kind must be brush_artwork.');
  }
  const layers = readLayers(value.layers);
  const totals = countArtwork(layers);
  if (totals.marks > BRUSH_ARTWORK_LIMITS.maxMarks) {
    throw new Error(`Brush artwork cannot exceed ${BRUSH_ARTWORK_LIMITS.maxMarks} marks.`);
  }
  if (totals.points > BRUSH_ARTWORK_LIMITS.maxPoints) {
    throw new Error(`Brush artwork cannot exceed ${BRUSH_ARTWORK_LIMITS.maxPoints} points.`);
  }
  return {
    seed: readSeed(value.seed),
    backgroundColor: readColor(value.backgroundColor, 'backgroundColor'),
    quality: value.quality == null ? 'standard' : readQuality(value.quality),
    layers,
  };
}

export function normalizeBrushArtworkSourceRef(value: unknown): BrushArtworkSourceRef {
  if (!isRecord(value) || value.kind !== 'brush_artwork') {
    throw new Error('Brush artwork source kind must be brush_artwork.');
  }
  return { kind: 'brush_artwork', ...normalizeBrushArtworkIntent(value) };
}

/** quality 是目标 DPI；极端盒子按统一像素预算等比缩小，不产生第二份几何事实。 */
export function resolveBrushArtworkPixelSize(
  intent: BrushArtworkIntent,
  targetSizeInches: { readonly width: number; readonly height: number },
): { readonly widthPx: number; readonly heightPx: number } {
  const width = readPositiveFinite(targetSizeInches.width, 'target width');
  const height = readPositiveFinite(targetSizeInches.height, 'target height');
  const dpi = DPI_BY_QUALITY[intent.quality ?? 'standard'];
  const requestedWidth = Math.max(1, Math.round(width * dpi));
  const requestedHeight = Math.max(1, Math.round(height * dpi));
  const scale = Math.min(
    1,
    MAX_DIMENSION_PX / requestedWidth,
    MAX_DIMENSION_PX / requestedHeight,
    Math.sqrt(MAX_PIXELS / (requestedWidth * requestedHeight)),
  );
  return {
    widthPx: Math.max(1, Math.floor(requestedWidth * scale)),
    heightPx: Math.max(1, Math.floor(requestedHeight * scale)),
  };
}

export function parseBrushArtworkRenderRequest(value: unknown): BrushArtworkRenderRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, ['requestId', 'intent', 'widthPx', 'heightPx'])) {
    throw new Error('Invalid Brush artwork render request.');
  }
  return {
    requestId: readNonEmptyString(value.requestId, 'requestId'),
    intent: normalizeBrushArtworkIntent(value.intent),
    widthPx: readPositiveInteger(value.widthPx, 'widthPx'),
    heightPx: readPositiveInteger(value.heightPx, 'heightPx'),
  };
}

export function parseBrushArtworkRenderResult(value: unknown): BrushArtworkRenderResult {
  if (!isRecord(value)) throw new Error('Invalid Brush artwork render result.');
  if (value.status === 'success') return parseSuccess(value);
  if (value.status === 'failure') return parseFailure(value);
  throw new Error('Invalid Brush artwork render result status.');
}

export function createBrushArtworkRenderFailure(
  requestId: string,
  code: BrushArtworkRenderErrorCode,
  message: string,
): BrushArtworkRenderFailure {
  return { status: 'failure', requestId, error: { code, message } };
}

function readLayers(value: unknown): readonly BrushArtworkLayer[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Brush artwork layers must be a non-empty array.');
  }
  if (value.length > BRUSH_ARTWORK_LIMITS.maxLayers) {
    throw new Error(`Brush artwork cannot exceed ${BRUSH_ARTWORK_LIMITS.maxLayers} layers.`);
  }
  return value.map((layer, index) => readLayer(layer, index));
}

function readLayer(value: unknown, index: number): BrushArtworkLayer {
  const field = `layers[${index}]`;
  if (!isRecord(value) || !hasOnlyKeys(value, ['stroke', 'fill', 'hatch', 'field', 'marks'])) {
    throw new Error(`Brush artwork ${field} must be a supported layer object.`);
  }
  const stroke = value.stroke == null ? undefined : readStroke(value.stroke, `${field}.stroke`);
  const fill = value.fill == null ? undefined : readFill(value.fill, `${field}.fill`);
  const hatch = value.hatch == null ? undefined : readHatch(value.hatch, `${field}.hatch`);
  const activeField = value.field == null ? undefined : readField(value.field);
  const marks = readMarks(value.marks, field);
  if (!stroke && !fill && !hatch) {
    throw new Error(`Brush artwork ${field} must define stroke, fill, or hatch.`);
  }
  if (!stroke && !marks.some(isClosedMark)) {
    throw new Error(`Brush artwork ${field} needs a stroke for open marks.`);
  }
  return {
    ...(stroke ? { stroke } : {}),
    ...(fill ? { fill } : {}),
    ...(hatch ? { hatch } : {}),
    ...(activeField ? { field: activeField } : {}),
    marks,
  };
}

function readStroke(value: unknown, field: string): BrushArtworkStroke {
  if (!isRecord(value) || !hasOnlyKeys(value, ['brush', 'color', 'weight'])) {
    throw new Error(`Brush artwork ${field} must be a supported stroke object.`);
  }
  return {
    brush: readBrush(value.brush),
    color: readColor(value.color, `${field}.color`),
    weight: value.weight == null ? 1 : readRange(value.weight, `${field}.weight`, 0.05, 12),
  };
}

function readFill(value: unknown, field: string): BrushArtworkFill {
  if (!isRecord(value)) throw new Error(`Brush artwork ${field} must be an object.`);
  switch (value.kind) {
    case 'watercolor':
      if (!hasOnlyKeys(value, [
        'kind', 'color', 'opacity', 'bleed', 'bleedDirection', 'bleedAngle',
        'texture', 'border', 'scatter',
      ])) throw new Error(`Brush artwork ${field} contains unsupported watercolor fields.`);
      return {
        kind: 'watercolor',
        color: readColor(value.color, `${field}.color`),
        opacity: value.opacity == null ? 150 : readIntegerRange(value.opacity, `${field}.opacity`, 1, 255),
        bleed: value.bleed == null ? 0.07 : readUnit(value.bleed, `${field}.bleed`),
        bleedDirection: value.bleedDirection == null
          ? 'out'
          : readBleedDirection(value.bleedDirection),
        ...(value.bleedAngle == null
          ? {}
          : { bleedAngle: readAngle(value.bleedAngle, `${field}.bleedAngle`) }),
        texture: value.texture == null ? 0.8 : readUnit(value.texture, `${field}.texture`),
        border: value.border == null ? 0.5 : readUnit(value.border, `${field}.border`),
        scatter: value.scatter == null ? true : readBoolean(value.scatter, `${field}.scatter`),
      };
    case 'wash':
      if (!hasOnlyKeys(value, ['kind', 'color', 'opacity'])) {
        throw new Error(`Brush artwork ${field} contains unsupported wash fields.`);
      }
      return {
        kind: 'wash',
        color: readColor(value.color, `${field}.color`),
        opacity: value.opacity == null ? 150 : readIntegerRange(value.opacity, `${field}.opacity`, 1, 255),
      };
    case 'mass':
      if (!hasOnlyKeys(value, [
        'kind', 'brush', 'color', 'precision', 'strength', 'gradient', 'outline',
      ])) throw new Error(`Brush artwork ${field} contains unsupported mass fields.`);
      return {
        kind: 'mass',
        brush: readBrush(value.brush),
        color: readColor(value.color, `${field}.color`),
        precision: value.precision == null ? 0.5 : readUnit(value.precision, `${field}.precision`),
        strength: value.strength == null ? 1 : readUnit(value.strength, `${field}.strength`),
        gradient: value.gradient == null ? 0.1 : readUnit(value.gradient, `${field}.gradient`),
        outline: value.outline == null ? false : readBoolean(value.outline, `${field}.outline`),
      };
    default:
      throw new Error(`Brush artwork ${field}.kind must be watercolor, wash, or mass.`);
  }
}

function readHatch(value: unknown, field: string): BrushArtworkHatch {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'brush', 'color', 'weight', 'spacing', 'angle', 'randomness', 'continuous', 'gradient',
  ])) throw new Error(`Brush artwork ${field} must be a supported hatch object.`);
  return {
    brush: readBrush(value.brush),
    color: readColor(value.color, `${field}.color`),
    weight: value.weight == null ? 0.65 : readRange(value.weight, `${field}.weight`, 0.05, 12),
    spacing: value.spacing == null ? 2.5 : readRange(value.spacing, `${field}.spacing`, 0.1, 50),
    angle: value.angle == null ? 45 : readAngle(value.angle, `${field}.angle`),
    randomness: value.randomness == null ? 0 : readUnit(value.randomness, `${field}.randomness`),
    continuous: value.continuous == null
      ? false
      : readBoolean(value.continuous, `${field}.continuous`),
    gradient: value.gradient == null ? 0 : readUnit(value.gradient, `${field}.gradient`),
  };
}

function readMarks(value: unknown, field: string): readonly BrushArtworkMark[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Brush artwork ${field}.marks must be a non-empty array.`);
  }
  return value.map((mark, index) => readMark(mark, `${field}.marks[${index}]`));
}

function readMark(value: unknown, field: string): BrushArtworkMark {
  if (!isRecord(value)) throw new Error(`Brush artwork ${field} must be an object.`);
  switch (value.type) {
    case 'line':
      assertKeys(value, ['type', 'from', 'to'], field);
      return {
        type: 'line',
        from: readPosition(value.from, `${field}.from`),
        to: readPosition(value.to, `${field}.to`),
      };
    case 'spline': {
      assertKeys(value, ['type', 'points', 'curvature'], field);
      const points = readPoints(value.points, `${field}.points`, 2);
      return {
        type: 'spline',
        points,
        curvature: value.curvature == null ? 0.5 : readUnit(value.curvature, `${field}.curvature`),
      };
    }
    case 'arc':
      assertKeys(value, ['type', 'center', 'radius', 'startAngle', 'endAngle'], field);
      return {
        type: 'arc',
        center: readPosition(value.center, `${field}.center`),
        radius: readRange(value.radius, `${field}.radius`, 0.01, 100),
        startAngle: readAngle(value.startAngle, `${field}.startAngle`),
        endAngle: readAngle(value.endAngle, `${field}.endAngle`),
      };
    case 'rect':
      assertKeys(value, ['type', 'x', 'y', 'width', 'height'], field);
      return {
        type: 'rect',
        x: readCoordinate(value.x, `${field}.x`),
        y: readCoordinate(value.y, `${field}.y`),
        width: readRange(value.width, `${field}.width`, 0.01, 100),
        height: readRange(value.height, `${field}.height`, 0.01, 100),
      };
    case 'ellipse':
      assertKeys(value, ['type', 'center', 'radiusX', 'radiusY', 'irregularity'], field);
      return {
        type: 'ellipse',
        center: readPosition(value.center, `${field}.center`),
        radiusX: readRange(value.radiusX, `${field}.radiusX`, 0.01, 100),
        radiusY: readRange(value.radiusY, `${field}.radiusY`, 0.01, 100),
        irregularity: value.irregularity == null
          ? 0
          : readUnit(value.irregularity, `${field}.irregularity`),
      };
    case 'polygon':
      assertKeys(value, ['type', 'points'], field);
      return {
        type: 'polygon',
        points: readPoints(value.points, `${field}.points`, 3),
      };
    case 'flowLine':
      assertKeys(value, ['type', 'from', 'length', 'direction'], field);
      return {
        type: 'flowLine',
        from: readPosition(value.from, `${field}.from`),
        length: readRange(value.length, `${field}.length`, 0.01, 200),
        direction: readAngle(value.direction, `${field}.direction`),
      };
    default:
      throw new Error(`Brush artwork ${field}.type is unsupported.`);
  }
}

function readPoints(value: unknown, field: string, minimum: number): readonly BrushArtworkPoint[] {
  if (!Array.isArray(value) || value.length < minimum) {
    throw new Error(`Brush artwork ${field} must contain at least ${minimum} points.`);
  }
  return value.map((point, index) => readPoint(point, `${field}[${index}]`));
}

function readPoint(value: unknown, field: string): BrushArtworkPoint {
  if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3)) {
    throw new Error(`Brush artwork ${field} must be [x, y] or [x, y, pressure].`);
  }
  const x = readCoordinate(value[0], `${field}[0]`);
  const y = readCoordinate(value[1], `${field}[1]`);
  return value.length === 2
    ? [x, y]
    : [x, y, readRange(value[2], `${field}[2]`, 0, 2)];
}

function readPosition(value: unknown, field: string): BrushArtworkPosition {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`Brush artwork ${field} must be [x, y].`);
  }
  return [
    readCoordinate(value[0], `${field}[0]`),
    readCoordinate(value[1], `${field}[1]`),
  ];
}

function countArtwork(layers: readonly BrushArtworkLayer[]): { marks: number; points: number } {
  let marks = 0;
  let points = 0;
  for (const layer of layers) {
    marks += layer.marks.length;
    for (const mark of layer.marks) points += countMarkPoints(mark);
  }
  return { marks, points };
}

function countMarkPoints(mark: BrushArtworkMark): number {
  switch (mark.type) {
    case 'line':
      return 2;
    case 'spline':
    case 'polygon':
      return mark.points.length;
    case 'arc':
    case 'ellipse':
    case 'flowLine':
      return 1;
    case 'rect':
      return 4;
  }
}

function isClosedMark(mark: BrushArtworkMark): boolean {
  return mark.type === 'rect' || mark.type === 'ellipse' || mark.type === 'polygon';
}

function parseSuccess(value: Record<string, unknown>): BrushArtworkRenderSuccess {
  if (!hasOnlyKeys(value, ['status', 'requestId', 'widthPx', 'heightPx', 'bytes'])
    || !(value.bytes instanceof Uint8Array)) {
    throw new Error('Invalid successful Brush artwork render result.');
  }
  return {
    status: 'success',
    requestId: readNonEmptyString(value.requestId, 'requestId'),
    widthPx: readPositiveInteger(value.widthPx, 'widthPx'),
    heightPx: readPositiveInteger(value.heightPx, 'heightPx'),
    bytes: value.bytes,
  };
}

function parseFailure(value: Record<string, unknown>): BrushArtworkRenderFailure {
  if (!hasOnlyKeys(value, ['status', 'requestId', 'error']) || !isRecord(value.error)
    || !hasOnlyKeys(value.error, ['code', 'message'])) {
    throw new Error('Invalid failed Brush artwork render result.');
  }
  return {
    status: 'failure',
    requestId: readNonEmptyString(value.requestId, 'requestId'),
    error: {
      code: readErrorCode(value.error.code),
      message: readNonEmptyString(value.error.message, 'error.message'),
    },
  };
}

function readBrush(value: unknown): BrushArtworkBrush {
  switch (value) {
    case 'pen':
    case 'rotring':
    case '2B':
    case 'HB':
    case '2H':
    case 'cpencil':
    case 'pastel':
    case 'crayon':
    case 'charcoal':
    case 'spray':
    case 'marker':
      return value;
    default:
      throw new Error(`Brush artwork brush must be one of: ${BRUSH_ARTWORK_BRUSHES.join(', ')}.`);
  }
}

function readField(value: unknown): BrushArtworkField {
  switch (value) {
    case 'hand':
    case 'curved':
    case 'zigzag':
    case 'waves':
    case 'seabed':
    case 'spiral':
    case 'columns':
      return value;
    default:
      throw new Error(`Brush artwork field must be one of: ${BRUSH_ARTWORK_FIELDS.join(', ')}.`);
  }
}

function readQuality(value: unknown): BrushArtworkQuality {
  switch (value) {
    case 'draft':
    case 'standard':
    case 'high':
      return value;
    default:
      throw new Error(`Brush artwork quality must be one of: ${BRUSH_ARTWORK_QUALITIES.join(', ')}.`);
  }
}

function readBleedDirection(value: unknown): 'in' | 'out' {
  if (value === 'in' || value === 'out') return value;
  throw new Error('Brush artwork bleedDirection must be in or out.');
}

function readSeed(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xFFFFFFFF) {
    return value;
  }
  throw new Error('Brush artwork seed must be an integer between 0 and 4294967295.');
}

function readColor(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Brush artwork ${field} must be #RRGGBB.`);
  const normalized = value.trim().toUpperCase();
  if (!HEX_COLOR.test(normalized)) throw new Error(`Brush artwork ${field} must be #RRGGBB.`);
  return normalized;
}

function readCoordinate(value: unknown, field: string): number {
  return readRange(value, field, 0, 100);
}

function readAngle(value: unknown, field: string): number {
  return readRange(value, field, -3600, 3600);
}

function readUnit(value: unknown, field: string): number {
  return readRange(value, field, 0, 1);
}

function readRange(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`Brush artwork ${field} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function readIntegerRange(value: unknown, field: string, minimum: number, maximum: number): number {
  const result = readRange(value, field, minimum, maximum);
  if (!Number.isInteger(result)) throw new Error(`Brush artwork ${field} must be an integer.`);
  return result;
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Brush artwork ${field} must be boolean.`);
  return value;
}

function readErrorCode(value: unknown): BrushArtworkRenderErrorCode {
  switch (value) {
    case 'slides.brush.invalid_request':
    case 'slides.brush.runtime_unavailable':
    case 'slides.brush.render_failed':
    case 'slides.brush.encode_failed':
      return value;
    default:
      throw new Error('Invalid Brush artwork error code.');
  }
}

function readNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be non-empty.`);
  return value;
}

function readPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return value;
}

function readPositiveFinite(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be positive.`);
  }
  return value;
}

function assertKeys(value: Record<string, unknown>, keys: readonly string[], field: string): void {
  if (!hasOnlyKeys(value, keys)) throw new Error(`Brush artwork ${field} contains unsupported fields.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}
