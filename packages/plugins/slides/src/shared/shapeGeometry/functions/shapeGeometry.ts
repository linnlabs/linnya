import {
  DEFAULT_SHAPE_GEOMETRY,
  MAX_SHAPE_PATH_COMMANDS,
  MAX_SHAPE_POLYGON_POINTS,
  PRESET_SHAPE_NAMES,
  type ParallelogramGeometrySpec,
  type PathGeometrySpec,
  type PolygonGeometrySpec,
  type PresetShapeName,
  type RegularPolygonGeometrySpec,
  type ResolvedPathShapeGeometry,
  type ResolvedShapeGeometry,
  type ShapeGeometrySpec,
  type ShapePathCommand,
  type ShapePoint,
  type ShapeViewBox,
  type TrapezoidGeometrySpec,
} from '../definitions/shapeGeometry';

const presetShapeNameSet: ReadonlySet<string> = new Set(PRESET_SHAPE_NAMES);
const MIN_POLYGON_AREA = 1e-8;

export class ShapeGeometryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShapeGeometryError';
  }
}

export function isPresetShapeName(value: unknown): value is PresetShapeName {
  return typeof value === 'string' && presetShapeNameSet.has(value);
}

/**
 * 把 deck.js / DeckSpec 语义几何解析成跨端唯一事实。
 * undefined 是 createShape() 的合法矩形默认值；显式未知名称不会降级。
 */
export function resolveShapeGeometry(
  input: ShapeGeometrySpec | undefined,
  fieldPath = 'geometry',
): ResolvedShapeGeometry {
  if (input == null) return DEFAULT_SHAPE_GEOMETRY;
  if (typeof input === 'string') {
    if (!isPresetShapeName(input)) {
      throw new ShapeGeometryError(`${fieldPath} 包含未知 preset "${input}"。`);
    }
    return { type: 'preset', name: input };
  }

  switch (input.type) {
    case 'preset':
      if (!isPresetShapeName(input.name)) {
        throw new ShapeGeometryError(`${fieldPath}.name 包含未知 preset "${String(input.name)}"。`);
      }
      return { type: 'preset', name: input.name };
    case 'regularPolygon':
      return resolveRegularPolygon(input, fieldPath);
    case 'trapezoid':
      return resolveTrapezoid(input, fieldPath);
    case 'parallelogram':
      return resolveParallelogram(input, fieldPath);
    case 'polygon':
      return resolvePolygon(input, fieldPath);
    case 'path':
      return resolvePath(input, fieldPath);
  }
}

/** raw compose 输入的严格 parser；不接受额外类型或裸 SVG path。 */
export function parseShapeGeometrySpec(
  value: unknown,
  fieldPath = 'geometry',
): ShapeGeometrySpec | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') {
    if (!isPresetShapeName(value)) {
      throw new ShapeGeometryError(`${fieldPath} 包含未知 preset "${value}"。`);
    }
    return value;
  }
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new ShapeGeometryError(`${fieldPath} 必须是 preset 字符串或合法 geometry 对象。`);
  }

  let parsed: ShapeGeometrySpec;
  switch (value.type) {
    case 'preset':
      if (!isPresetShapeName(value.name)) {
        throw new ShapeGeometryError(`${fieldPath}.name 包含未知 preset "${String(value.name)}"。`);
      }
      parsed = { type: 'preset', name: value.name };
      break;
    case 'regularPolygon':
      parsed = {
        type: 'regularPolygon',
        sides: readFiniteNumber(value.sides, `${fieldPath}.sides`),
        rotation: readOptionalFiniteNumber(value.rotation, `${fieldPath}.rotation`),
      };
      break;
    case 'trapezoid':
      parsed = {
        type: 'trapezoid',
        topLeftInset: readFiniteNumber(value.topLeftInset, `${fieldPath}.topLeftInset`),
        topRightInset: readFiniteNumber(value.topRightInset, `${fieldPath}.topRightInset`),
      };
      break;
    case 'parallelogram':
      if (value.direction != null && value.direction !== 'left' && value.direction !== 'right') {
        throw new ShapeGeometryError(`${fieldPath}.direction 必须是 left 或 right。`);
      }
      parsed = {
        type: 'parallelogram',
        slant: readFiniteNumber(value.slant, `${fieldPath}.slant`),
        direction: value.direction === 'left' || value.direction === 'right'
          ? value.direction
          : undefined,
      };
      break;
    case 'polygon':
      if (!Array.isArray(value.points)) {
        throw new ShapeGeometryError(`${fieldPath}.points 必须是点数组。`);
      }
      parsed = {
        type: 'polygon',
        points: value.points.map((point, index) => readPoint(point, `${fieldPath}.points[${index}]`)),
      };
      break;
    case 'path':
      parsed = {
        type: 'path',
        viewBox: readViewBox(value.viewBox, `${fieldPath}.viewBox`),
        commands: readCommands(value.commands, `${fieldPath}.commands`),
      };
      break;
    default:
      throw new ShapeGeometryError(`${fieldPath}.type 不支持 "${value.type}"。`);
  }

  // parser 与 typed 调用必须共享同一套业务校验。
  resolveShapeGeometry(parsed, fieldPath);
  return parsed;
}

export function serializeShapePath(
  geometry: ResolvedPathShapeGeometry,
  outputWidth: number,
  outputHeight: number,
): string {
  assertPositiveFinite(outputWidth, 'outputWidth');
  assertPositiveFinite(outputHeight, 'outputHeight');
  const sx = outputWidth / geometry.viewBox.width;
  const sy = outputHeight / geometry.viewBox.height;
  return geometry.commands.map((command) => {
    switch (command.type) {
      case 'moveTo': return `M ${format(command.x * sx)} ${format(command.y * sy)}`;
      case 'lineTo': return `L ${format(command.x * sx)} ${format(command.y * sy)}`;
      case 'quadraticTo':
        return `Q ${format(command.x1 * sx)} ${format(command.y1 * sy)} ${format(command.x * sx)} ${format(command.y * sy)}`;
      case 'cubicTo':
        return `C ${format(command.x1 * sx)} ${format(command.y1 * sy)} ${format(command.x2 * sx)} ${format(command.y2 * sy)} ${format(command.x * sx)} ${format(command.y * sy)}`;
      case 'close': return 'Z';
    }
  }).join(' ');
}

/** 只含 move/line/close 的 path 可直接交给 Konva.Line。 */
export function shapePathToPointArray(
  geometry: ResolvedPathShapeGeometry,
  outputWidth: number,
  outputHeight: number,
): number[] | undefined {
  const points: number[] = [];
  const sx = outputWidth / geometry.viewBox.width;
  const sy = outputHeight / geometry.viewBox.height;
  for (const command of geometry.commands) {
    if (command.type === 'moveTo' || command.type === 'lineTo') {
      points.push(command.x * sx, command.y * sy);
      continue;
    }
    if (command.type !== 'close') return undefined;
  }
  return points;
}

/** renderer 对 native preset 的 local-space 权威展开；rect/ellipse/line 由原语处理。 */
export function resolvePresetShapePath(name: PresetShapeName): ResolvedPathShapeGeometry | undefined {
  switch (name) {
    case 'triangle': return polygonPath([[0.5, 0], [1, 1], [0, 1]]);
    case 'rightTriangle': return polygonPath([[0, 0], [0, 1], [1, 1]]);
    case 'diamond': return polygonPath([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]);
    case 'pentagon': return regularPolygonPath(5, -90);
    case 'hexagon': return regularPolygonPath(6, -90);
    case 'star5': return starPath(5, 0.4);
    case 'rightArrow':
      return polygonPath([[0, 0.25], [0.7, 0.25], [0.7, 0], [1, 0.5], [0.7, 1], [0.7, 0.75], [0, 0.75]]);
    case 'callout':
      return polygonPath([[0, 0], [1, 0], [1, 0.78], [0.36, 0.78], [0.252, 1], [0.18, 0.78], [0, 0.78]]);
    case 'parallelogram':
      return polygonPath([[0.2, 0], [1, 0], [0.8, 1], [0, 1]]);
    case 'trapezoid':
      return polygonPath([[0.2, 0], [0.8, 0], [1, 1], [0, 1]]);
    case 'nonIsoscelesTrapezoid':
      return polygonPath([[0, 0], [0.8, 0], [1, 1], [0, 1]]);
    case 'chevron':
      return polygonPath([[0, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0, 1], [0.25, 0.5]]);
    default:
      return undefined;
  }
}

function resolveRegularPolygon(
  input: RegularPolygonGeometrySpec,
  fieldPath: string,
): ResolvedPathShapeGeometry {
  if (!Number.isInteger(input.sides) || input.sides < 3 || input.sides > 32) {
    throw new ShapeGeometryError(`${fieldPath}.sides 必须是 3..32 的整数。`);
  }
  const rotation = input.rotation ?? -90;
  if (!Number.isFinite(rotation)) {
    throw new ShapeGeometryError(`${fieldPath}.rotation 必须是有限数。`);
  }
  return regularPolygonPath(input.sides, rotation);
}

function resolveTrapezoid(
  input: TrapezoidGeometrySpec,
  fieldPath: string,
): ResolvedPathShapeGeometry {
  assertRatio(input.topLeftInset, `${fieldPath}.topLeftInset`);
  assertRatio(input.topRightInset, `${fieldPath}.topRightInset`);
  if (input.topLeftInset === 0 && input.topRightInset === 0) {
    throw new ShapeGeometryError(`${fieldPath} 没有缩进，应该使用 rect。`);
  }
  if (input.topLeftInset + input.topRightInset >= 1) {
    throw new ShapeGeometryError(`${fieldPath} 的左右缩进之和必须小于 1。`);
  }
  return polygonPath([
    [input.topLeftInset, 0],
    [1 - input.topRightInset, 0],
    [1, 1],
    [0, 1],
  ]);
}

function resolveParallelogram(
  input: ParallelogramGeometrySpec,
  fieldPath: string,
): ResolvedPathShapeGeometry {
  if (!Number.isFinite(input.slant) || input.slant <= 0 || input.slant >= 0.5) {
    throw new ShapeGeometryError(`${fieldPath}.slant 必须大于 0 且小于 0.5。`);
  }
  return input.direction === 'left'
    ? polygonPath([[0, 0], [1 - input.slant, 0], [1, 1], [input.slant, 1]])
    : polygonPath([[input.slant, 0], [1, 0], [1 - input.slant, 1], [0, 1]]);
}

function resolvePolygon(
  input: PolygonGeometrySpec,
  fieldPath: string,
): ResolvedPathShapeGeometry {
  if (input.points.length < 3) {
    throw new ShapeGeometryError(`${fieldPath}.points 至少需要三个点。`);
  }
  if (input.points.length > MAX_SHAPE_POLYGON_POINTS) {
    throw new ShapeGeometryError(`${fieldPath}.points 不能超过 ${MAX_SHAPE_POLYGON_POINTS} 个点。`);
  }
  input.points.forEach((point, index) => {
    assertNormalizedPoint(point, `${fieldPath}.points[${index}]`);
    const previous = input.points[(index + input.points.length - 1) % input.points.length];
    if (point.x === previous.x && point.y === previous.y) {
      throw new ShapeGeometryError(`${fieldPath}.points[${index}] 与相邻点重复。`);
    }
  });
  if (Math.abs(polygonArea(input.points)) < MIN_POLYGON_AREA) {
    throw new ShapeGeometryError(`${fieldPath}.points 形成了零面积轮廓。`);
  }
  return polygonPath(input.points.map((point) => [point.x, point.y]));
}

function resolvePath(input: PathGeometrySpec, fieldPath: string): ResolvedPathShapeGeometry {
  assertPositiveFinite(input.viewBox.width, `${fieldPath}.viewBox.width`);
  assertPositiveFinite(input.viewBox.height, `${fieldPath}.viewBox.height`);
  if (input.commands.length < 2) {
    throw new ShapeGeometryError(`${fieldPath}.commands 至少需要 move 和一条绘制命令。`);
  }
  if (input.commands.length > MAX_SHAPE_PATH_COMMANDS) {
    throw new ShapeGeometryError(`${fieldPath}.commands 不能超过 ${MAX_SHAPE_PATH_COMMANDS} 条。`);
  }
  if (input.commands[0]?.type !== 'moveTo') {
    throw new ShapeGeometryError(`${fieldPath}.commands[0] 必须是 moveTo。`);
  }
  let subpathOpen = false;
  let closed = false;
  let moveCount = 0;
  input.commands.forEach((command, index) => {
    validateCommand(command, input.viewBox, `${fieldPath}.commands[${index}]`);
    if (command.type === 'moveTo') {
      moveCount += 1;
      if (moveCount > 1) {
        throw new ShapeGeometryError(`${fieldPath}.commands 首期只支持一个闭合子路径。`);
      }
      subpathOpen = true;
      closed = false;
    } else if (command.type === 'close') {
      if (!subpathOpen) {
        throw new ShapeGeometryError(`${fieldPath}.commands[${index}] 没有可关闭的子路径。`);
      }
      subpathOpen = false;
      closed = true;
    } else if (!subpathOpen) {
      throw new ShapeGeometryError(`${fieldPath}.commands[${index}] 必须位于 moveTo 之后。`);
    }
  });
  return {
    type: 'path',
    viewBox: { ...input.viewBox },
    commands: input.commands.map((command) => ({ ...command })),
    // AI 高频用 typed path 画曲线和连线；没有 close 表示开放路径，
    // 不应被物化层擅自闭合为带填充的轮廓。
    closed: closed && !subpathOpen,
  };
}

function polygonPath(points: readonly (readonly [number, number])[]): ResolvedPathShapeGeometry {
  const [first, ...rest] = points;
  if (!first) throw new ShapeGeometryError('polygon 至少需要一个起点。');
  return {
    type: 'path',
    viewBox: { width: 1, height: 1 },
    commands: [
      { type: 'moveTo', x: first[0], y: first[1] },
      ...rest.map(([x, y]): ShapePathCommand => ({ type: 'lineTo', x, y })),
      { type: 'close' },
    ],
    closed: true,
  };
}

function regularPolygonPath(sides: number, rotationDegree: number): ResolvedPathShapeGeometry {
  const start = rotationDegree * Math.PI / 180;
  const points: Array<readonly [number, number]> = [];
  for (let index = 0; index < sides; index++) {
    const angle = start + 2 * Math.PI * index / sides;
    points.push([round6(0.5 + 0.5 * Math.cos(angle)), round6(0.5 + 0.5 * Math.sin(angle))]);
  }
  return polygonPath(points);
}

function starPath(points: number, innerRatio: number): ResolvedPathShapeGeometry {
  const vertices: Array<readonly [number, number]> = [];
  for (let index = 0; index < points * 2; index++) {
    const radius = index % 2 === 0 ? 0.5 : 0.5 * innerRatio;
    const angle = -Math.PI / 2 + Math.PI * index / points;
    vertices.push([round6(0.5 + radius * Math.cos(angle)), round6(0.5 + radius * Math.sin(angle))]);
  }
  return polygonPath(vertices);
}

function validateCommand(command: ShapePathCommand, viewBox: ShapeViewBox, fieldPath: string): void {
  if (command.type === 'close') return;
  assertPointInViewBox(command, viewBox, fieldPath);
  if (command.type === 'quadraticTo' || command.type === 'cubicTo') {
    assertPointInViewBox({ x: command.x1, y: command.y1 }, viewBox, `${fieldPath}.control1`);
  }
  if (command.type === 'cubicTo') {
    assertPointInViewBox({ x: command.x2, y: command.y2 }, viewBox, `${fieldPath}.control2`);
  }
}

function readCommands(value: unknown, fieldPath: string): ShapePathCommand[] {
  if (!Array.isArray(value)) throw new ShapeGeometryError(`${fieldPath} 必须是 command 数组。`);
  return value.map((entry, index) => {
    const path = `${fieldPath}[${index}]`;
    if (!isRecord(entry) || typeof entry.type !== 'string') {
      throw new ShapeGeometryError(`${path} 必须是合法 command。`);
    }
    switch (entry.type) {
      case 'moveTo':
      case 'lineTo':
        return { type: entry.type, x: readFiniteNumber(entry.x, `${path}.x`), y: readFiniteNumber(entry.y, `${path}.y`) };
      case 'quadraticTo':
        return {
          type: 'quadraticTo',
          x1: readFiniteNumber(entry.x1, `${path}.x1`),
          y1: readFiniteNumber(entry.y1, `${path}.y1`),
          x: readFiniteNumber(entry.x, `${path}.x`),
          y: readFiniteNumber(entry.y, `${path}.y`),
        };
      case 'cubicTo':
        return {
          type: 'cubicTo',
          x1: readFiniteNumber(entry.x1, `${path}.x1`),
          y1: readFiniteNumber(entry.y1, `${path}.y1`),
          x2: readFiniteNumber(entry.x2, `${path}.x2`),
          y2: readFiniteNumber(entry.y2, `${path}.y2`),
          x: readFiniteNumber(entry.x, `${path}.x`),
          y: readFiniteNumber(entry.y, `${path}.y`),
        };
      case 'close': return { type: 'close' };
      default: throw new ShapeGeometryError(`${path}.type 不支持 "${entry.type}"。`);
    }
  });
}

function readPoint(value: unknown, fieldPath: string): ShapePoint {
  if (!isRecord(value)) throw new ShapeGeometryError(`${fieldPath} 必须是 {x, y}。`);
  return {
    x: readFiniteNumber(value.x, `${fieldPath}.x`),
    y: readFiniteNumber(value.y, `${fieldPath}.y`),
  };
}

function readViewBox(value: unknown, fieldPath: string): ShapeViewBox {
  if (!isRecord(value)) throw new ShapeGeometryError(`${fieldPath} 必须是 {width, height}。`);
  return {
    width: readFiniteNumber(value.width, `${fieldPath}.width`),
    height: readFiniteNumber(value.height, `${fieldPath}.height`),
  };
}

function readFiniteNumber(value: unknown, fieldPath: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ShapeGeometryError(`${fieldPath} 必须是有限数。`);
  }
  return value;
}

function readOptionalFiniteNumber(value: unknown, fieldPath: string): number | undefined {
  return value == null ? undefined : readFiniteNumber(value, fieldPath);
}

function assertNormalizedPoint(point: ShapePoint, fieldPath: string): void {
  if (!Number.isFinite(point.x) || point.x < 0 || point.x > 1) {
    throw new ShapeGeometryError(`${fieldPath}.x 必须位于 0..1。`);
  }
  if (!Number.isFinite(point.y) || point.y < 0 || point.y > 1) {
    throw new ShapeGeometryError(`${fieldPath}.y 必须位于 0..1。`);
  }
}

function assertPointInViewBox(point: ShapePoint, viewBox: ShapeViewBox, fieldPath: string): void {
  if (!Number.isFinite(point.x) || point.x < 0 || point.x > viewBox.width) {
    throw new ShapeGeometryError(`${fieldPath}.x 必须位于 viewBox 内。`);
  }
  if (!Number.isFinite(point.y) || point.y < 0 || point.y > viewBox.height) {
    throw new ShapeGeometryError(`${fieldPath}.y 必须位于 viewBox 内。`);
  }
}

function assertRatio(value: number, fieldPath: string): void {
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new ShapeGeometryError(`${fieldPath} 必须位于 0..<1。`);
  }
}

function assertPositiveFinite(value: number, fieldPath: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ShapeGeometryError(`${fieldPath} 必须是正有限数。`);
  }
}

function polygonArea(points: readonly ShapePoint[]): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (!current || !next) continue;
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return twiceArea / 2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function format(value: number): string {
  return String(round6(value));
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
