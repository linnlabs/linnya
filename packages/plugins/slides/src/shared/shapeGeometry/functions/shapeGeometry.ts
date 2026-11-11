import { isRecord } from '../../valueRecord';
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

/** 只含 move/line/close 的单个子路径可直接交给 Konva.Line；多个子路径会被 Line 连成一笔。 */
export function shapePathToPointArray(
  geometry: ResolvedPathShapeGeometry,
  outputWidth: number,
  outputHeight: number,
): number[] | undefined {
  if (countShapeSubpaths(geometry) > 1) return undefined;
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

/**
 * renderer 对 native preset 的权威展开，与 PPTX 写出的 `prstGeom`（默认调节值）逐点一致。
 * 公式取自 ECMA-376 presetShapeDefinitions：很多预设的斜边、箭头、内缩按短边 `ss = min(w, h)` 计算，
 * 所以必须传入盒子宽高，坐标系就是这个宽高（任意单位）。`callout` 的尾巴按 PowerPoint 伸到盒子下方。
 * rect / ellipse / line / roundRect 由原语处理，返回 undefined。2026-11-11 用 PowerPoint 导出 PDF 两种宽高比核对。
 */
export function resolvePresetShapePath(
  name: PresetShapeName,
  width: number,
  height: number,
): ResolvedPathShapeGeometry | undefined {
  const w = width;
  const h = height;
  const ss = Math.min(w, h);
  const hc = w / 2;
  const vc = h / 2;
  const polygon = (points: Array<readonly [number, number]>) => boxPolygonPath(points, w, h);
  switch (name) {
    case 'triangle': return polygon([[0, h], [hc, 0], [w, h]]);
    case 'rightTriangle': return polygon([[0, h], [0, 0], [w, h]]);
    case 'diamond': return polygon([[0, vc], [hc, 0], [w, vc], [hc, h]]);
    case 'pentagon': {
      // hf = 105146、vf = 110557：把正五边形拉满外框。
      const swd2 = (w / 2) * 1.05146;
      const shd2 = (h / 2) * 1.10557;
      const svc = vc * 1.10557;
      const dx1 = swd2 * Math.cos(deg(18));
      const dx2 = swd2 * Math.cos(deg(306));
      const y1 = svc - shd2 * Math.sin(deg(18));
      const y2 = svc - shd2 * Math.sin(deg(306));
      return polygon([[hc - dx1, y1], [hc, 0], [hc + dx1, y1], [hc + dx2, y2], [hc - dx2, y2]]);
    }
    case 'hexagon': {
      // adj = 25000、vf = 115470：平顶，左右两尖，横向内缩 0.25·ss。
      const x1 = ss * Math.min(0.25, 0.5 * w / ss);
      const dy1 = (h / 2) * 1.1547 * Math.sin(deg(60));
      return polygon([[0, vc], [x1, vc - dy1], [w - x1, vc - dy1], [w, vc], [w - x1, vc + dy1], [x1, vc + dy1]]);
    }
    case 'star5': {
      // adj = 19098、hf = 105146、vf = 110557。
      const swd2 = (w / 2) * 1.05146;
      const shd2 = (h / 2) * 1.10557;
      const svc = vc * 1.10557;
      const dx1 = swd2 * Math.cos(deg(18));
      const dx2 = swd2 * Math.cos(deg(306));
      const y1 = svc - shd2 * Math.sin(deg(18));
      const y2 = svc - shd2 * Math.sin(deg(306));
      const iwd2 = swd2 * 19098 / 50000;
      const ihd2 = shd2 * 19098 / 50000;
      const sdx1 = iwd2 * Math.cos(deg(342));
      const sdx2 = iwd2 * Math.cos(deg(54));
      const sy1 = svc - ihd2 * Math.sin(deg(54));
      const sy2 = svc - ihd2 * Math.sin(deg(342));
      return polygon([
        [hc - dx1, y1], [hc - sdx2, sy1], [hc, 0], [hc + sdx2, sy1], [hc + dx1, y1],
        [hc + sdx1, sy2], [hc + dx2, y2], [hc, svc + ihd2], [hc - dx2, y2], [hc - sdx1, sy2],
      ]);
    }
    case 'rightArrow': {
      // adj1 = 50000（箭身占高一半）、adj2 = 50000（箭头长 0.5·ss）。
      const x1 = w - ss * Math.min(0.5, w / ss);
      return polygon([[0, h * 0.25], [x1, h * 0.25], [x1, 0], [w, vc], [x1, h], [x1, h * 0.75], [0, h * 0.75]]);
    }
    case 'callout': {
      // wedgeRectCallout，adj1 = -20833、adj2 = 62500：尾尖在盒子下方 h/8，根部 w/6–5w/12。
      const tipX = hc - w * 0.20833;
      const tipY = vc + h * 0.625;
      return polygon([[0, 0], [w, 0], [w, h], [w * 5 / 12, h], [tipX, tipY], [w / 6, h], [0, h]]);
    }
    case 'parallelogram': {
      const x2 = ss * Math.min(0.25, w / ss);
      return polygon([[0, h], [x2, 0], [w, 0], [w - x2, h]]);
    }
    case 'trapezoid':
    case 'nonIsoscelesTrapezoid': {
      // 两者默认调节值相同：上边两侧各内缩 0.25·ss。
      const x3 = ss * Math.min(0.25, 0.5 * w / ss);
      return polygon([[0, h], [x3, 0], [w - x3, 0], [w, h]]);
    }
    case 'chevron': {
      const x1 = ss * Math.min(0.5, w / ss);
      return polygon([[0, 0], [w - x1, 0], [w, vc], [w - x1, h], [0, h], [x1, vc]]);
    }
    default:
      return undefined;
  }
}

function deg(value: number): number {
  return value * Math.PI / 180;
}

function boxPolygonPath(
  points: ReadonlyArray<readonly [number, number]>,
  width: number,
  height: number,
): ResolvedPathShapeGeometry {
  const [first, ...rest] = points.map(([x, y]) => [round6(x), round6(y)] as const);
  return {
    type: 'path',
    viewBox: { width, height },
    commands: [
      { type: 'moveTo', x: first[0], y: first[1] },
      ...rest.map(([x, y]): ShapePathCommand => ({ type: 'lineTo', x, y })),
      { type: 'close' },
    ],
    closed: true,
  };
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
      // 多个子路径按奇偶规则填充（PowerPoint 同一 a:path 内的行为），用来挖洞和画分离笔画；
      // 开放的线段混在里面时两端填充语义不一致，所以每一段都必须先闭合。
      if (moveCount > 1 && !closed) {
        throw new ShapeGeometryError(`${fieldPath}.commands[${index}] 之前的子路径没有 close；多个子路径时每一段都要闭合。`);
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

function countShapeSubpaths(geometry: ResolvedPathShapeGeometry): number {
  return geometry.commands.filter((command) => command.type === 'moveTo').length;
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


function format(value: number): string {
  return String(round6(value));
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
