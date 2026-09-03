import { SvgGraphicAdmissionError } from '@plugin/slides/shared/svgGraphic';

export function countSvgGraphicPathSegments(value: string, elementPath: string): number {
  const tokenPattern = /[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
  const tokens = value.match(tokenPattern) ?? [];
  const residue = value.replace(tokenPattern, '').replace(/[\s,]+/g, '');
  if (tokens.length === 0 || residue.length > 0 || !/^[Mm]$/.test(tokens[0] ?? '')) {
    throw unsupportedAttribute(
      elementPath,
      'd',
      'path d 必须是完整且以 M/m 开始的 SVG path。'
    );
  }

  const arity: Readonly<Record<string, number>> = {
    M: 2,
    L: 2,
    H: 1,
    V: 1,
    C: 6,
    S: 4,
    Q: 4,
    T: 2,
    A: 7,
    Z: 0,
  };
  let index = 0;
  let segments = 0;
  while (index < tokens.length) {
    const command = tokens[index];
    if (!command || !isPathCommand(command)) {
      throw unsupportedAttribute(elementPath, 'd', 'path d 的隐式命令位置不合法。');
    }
    index += 1;
    const upper = command.toUpperCase();
    if (upper === 'Z') {
      segments += 1;
      continue;
    }
    const numbers: number[] = [];
    while (index < tokens.length && !isPathCommand(tokens[index] ?? '')) {
      numbers.push(parseFiniteSvgNumber(tokens[index] ?? '', elementPath, 'd'));
      index += 1;
    }
    const commandArity = arity[upper];
    if (!commandArity || numbers.length < commandArity || numbers.length % commandArity !== 0) {
      throw unsupportedAttribute(
        elementPath,
        'd',
        `path 命令 ${command} 的参数数量不正确。`
      );
    }
    if (upper === 'A') {
      validateArcArguments(numbers, commandArity, elementPath);
    }
    segments += numbers.length / commandArity;
  }
  return segments;
}

export function validateSvgPoints(value: string, elementPath: string): void {
  const points = parseSvgNumberList(value, elementPath, 'points');
  if (points.length < 4 || points.length % 2 !== 0) {
    throw unsupportedAttribute(
      elementPath,
      'points',
      'points 必须包含至少两个完整坐标点。'
    );
  }
}

export function validateSvgDashArray(value: string, elementPath: string): void {
  if (value === 'none') return;
  const values = parseSvgNumberList(value, elementPath, 'stroke-dasharray');
  if (
    values.length === 0 ||
    values.some(number => number < 0) ||
    values.every(number => number === 0)
  ) {
    throw unsupportedAttribute(
      elementPath,
      'stroke-dasharray',
      'dash 数组必须是非负有限数值，且不能全为 0。'
    );
  }
}

export function parseSvgNumberList(
  value: string,
  elementPath: string,
  attributeName: string
): number[] {
  const tokens = value.trim().split(/[\s,]+/).filter(Boolean);
  return tokens.map(token => parseFiniteSvgNumber(token, elementPath, attributeName));
}

export function parseFiniteSvgNumber(
  value: string,
  elementPath: string,
  attributeName: string
): number {
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(value)) {
    throw unsupportedAttribute(
      elementPath,
      attributeName,
      '属性只允许无单位有限数值。'
    );
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw unsupportedAttribute(elementPath, attributeName, '属性数值必须有限。');
  }
  return number;
}

export function parseSvgUnitInterval(
  value: string,
  elementPath: string,
  attributeName: string
): number {
  const number = parseFiniteSvgNumber(value, elementPath, attributeName);
  if (number < 0 || number > 1) {
    throw unsupportedAttribute(elementPath, attributeName, '透明度必须位于 0–1。');
  }
  return number;
}

export function parseSvgOffset(value: string, elementPath: string): number {
  const percentage = value.endsWith('%');
  const number = parseFiniteSvgNumber(
    percentage ? value.slice(0, -1) : value,
    elementPath,
    'offset'
  );
  const normalized = percentage ? number / 100 : number;
  if (normalized < 0 || normalized > 1) {
    throw unsupportedAttribute(
      elementPath,
      'offset',
      'gradient stop offset 必须位于 0–1 或 0%–100%。'
    );
  }
  return normalized;
}

export function parseSvgNumberOrPercentage(
  value: string,
  elementPath: string,
  attributeName: string
): number {
  const percentage = value.endsWith('%');
  return parseFiniteSvgNumber(
    percentage ? value.slice(0, -1) : value,
    elementPath,
    attributeName
  );
}

export function requireSvgValue(
  value: string,
  allowed: readonly string[],
  elementPath: string,
  attributeName: string
): void {
  if (!allowed.includes(value)) {
    throw unsupportedAttribute(
      elementPath,
      attributeName,
      `属性只允许：${allowed.join('、')}。`
    );
  }
}

export function unsupportedAttribute(
  elementPath: string,
  attributeName: string,
  detail: string
): SvgGraphicAdmissionError {
  return new SvgGraphicAdmissionError(
    'slides.svg.unsupported_attribute',
    `${elementPath}/@${attributeName}: ${detail}`,
    elementPath
  );
}

function validateArcArguments(
  numbers: readonly number[],
  commandArity: number,
  elementPath: string
): void {
  for (let offset = 0; offset < numbers.length; offset += commandArity) {
    const radiusX = numbers[offset];
    const radiusY = numbers[offset + 1];
    const largeArcFlag = numbers[offset + 3];
    const sweepFlag = numbers[offset + 4];
    if (radiusX === undefined || radiusY === undefined || radiusX < 0 || radiusY < 0) {
      throw unsupportedAttribute(elementPath, 'd', 'arc 半径不能为负数。');
    }
    if ((largeArcFlag !== 0 && largeArcFlag !== 1) || (sweepFlag !== 0 && sweepFlag !== 1)) {
      throw unsupportedAttribute(elementPath, 'd', 'arc flags 只能是 0 或 1。');
    }
  }
}

function isPathCommand(value: string): boolean {
  return /^[AaCcHhLlMmQqSsTtVvZz]$/.test(value);
}
