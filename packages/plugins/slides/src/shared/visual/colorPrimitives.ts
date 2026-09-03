export interface NormalizeSuccess<T> {
  value: T;
}

export interface NormalizeFailure {
  error: string;
}

export type NormalizeResult<T> = NormalizeSuccess<T> | NormalizeFailure;

interface ParsedColorLiteral {
  hex: string;
  alpha?: number;
}

const HEX_COLOR_SHORT_RE = /^#?([0-9A-Fa-f]{3})$/;
const HEX_COLOR_RE = /^#?([0-9A-Fa-f]{6})$/;
const RGB_COLOR_RE = /^rgb\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*\)$/i;
const RGBA_COLOR_RE = /^rgba\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([01](?:\.\d+)?|0?\.\d+)\s*\)$/i;
const CANONICAL_HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const EPSILON = 1e-6;

export function failure<T>(error: string): NormalizeResult<T> {
  return { error };
}

export function success<T>(value: T): NormalizeResult<T> {
  return { value };
}

function isApproximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= EPSILON;
}

function byteToHex(value: number): string {
  return value.toString(16).padStart(2, '0').toUpperCase();
}

function parseByte(raw: string): number | null {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    return null;
  }
  return value;
}

function parseAlpha(raw: string): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    return null;
  }
  return value;
}

function parseColorLiteral(value: string, path: string): NormalizeResult<ParsedColorLiteral> {
  const trimmed = value.trim();
  const hex6Match = trimmed.match(HEX_COLOR_RE);
  if (hex6Match) {
    return success({ hex: `#${hex6Match[1].toUpperCase()}` });
  }

  const hex3Match = trimmed.match(HEX_COLOR_SHORT_RE);
  if (hex3Match) {
    const [r, g, b] = hex3Match[1].split('');
    return success({
      hex: `#${r}${r}${g}${g}${b}${b}`.toUpperCase(),
    });
  }

  const rgbMatch = trimmed.match(RGB_COLOR_RE);
  if (rgbMatch) {
    const r = parseByte(rgbMatch[1]);
    const g = parseByte(rgbMatch[2]);
    const b = parseByte(rgbMatch[3]);
    if (r == null || g == null || b == null) {
      return failure(`${path} 必须是合法颜色字符串；仅支持 #RGB / #RRGGBB / rgb() / rgba()。`);
    }
    return success({ hex: `#${byteToHex(r)}${byteToHex(g)}${byteToHex(b)}` });
  }

  const rgbaMatch = trimmed.match(RGBA_COLOR_RE);
  if (rgbaMatch) {
    const r = parseByte(rgbaMatch[1]);
    const g = parseByte(rgbaMatch[2]);
    const b = parseByte(rgbaMatch[3]);
    const alpha = parseAlpha(rgbaMatch[4]);
    if (r == null || g == null || b == null || alpha == null) {
      return failure(`${path} 必须是合法颜色字符串；仅支持 #RGB / #RRGGBB / rgb() / rgba()。`);
    }
    return success({
      hex: `#${byteToHex(r)}${byteToHex(g)}${byteToHex(b)}`,
      alpha,
    });
  }

  return failure(`${path} 必须是合法颜色字符串；仅支持 #RGB / #RRGGBB / rgb() / rgba()。`);
}

export function normalizeOpaqueColor(value: string, path: string): NormalizeResult<string> {
  const parsed = parseColorLiteral(value, path);
  if ('error' in parsed) {
    return parsed;
  }
  if (parsed.value.alpha != null && !isApproximatelyEqual(parsed.value.alpha, 1)) {
    return failure(`${path} 不支持带 alpha 的颜色；请改用 #RRGGBB 和独立透明度字段。`);
  }
  return success(parsed.value.hex);
}

function mergeOpacityFromAlpha(
  path: string,
  currentOpacity: number | undefined,
  alpha: number | undefined,
): NormalizeResult<number | undefined> {
  if (alpha == null || isApproximatelyEqual(alpha, 1)) {
    return success(currentOpacity);
  }
  if (currentOpacity != null && !isApproximatelyEqual(currentOpacity, alpha)) {
    return failure(`${path} 同时提供了 rgba alpha 和独立透明度字段，语义冲突。`);
  }
  return success(alpha);
}

export function normalizeFillColor(
  value: string,
  path: string,
  currentOpacity?: number,
): NormalizeResult<{ color: string; opacity?: number }> {
  const parsed = parseColorLiteral(value, path);
  if ('error' in parsed) {
    return parsed;
  }
  const opacityResult = mergeOpacityFromAlpha(path, currentOpacity, parsed.value.alpha);
  if ('error' in opacityResult) {
    return opacityResult;
  }
  return success({
    color: parsed.value.hex,
    opacity: opacityResult.value,
  });
}

export function normalizeShadowColor(
  value: string,
  path: string,
  currentOpacity?: number,
): NormalizeResult<{ color: string; opacity?: number }> {
  const parsed = parseColorLiteral(value, path);
  if ('error' in parsed) {
    return parsed;
  }
  const opacityResult = mergeOpacityFromAlpha(path, currentOpacity, parsed.value.alpha);
  if ('error' in opacityResult) {
    return opacityResult;
  }
  return success({
    color: parsed.value.hex,
    opacity: opacityResult.value,
  });
}

export function assertCanonicalHexColor(value: string, path: string): string {
  if (CANONICAL_HEX_RE.test(value)) {
    return value.toUpperCase();
  }
  // 自动归一化 #RGB -> #RRGGBB
  const shortMatch = value.match(HEX_COLOR_SHORT_RE);
  if (shortMatch) {
    const [r, g, b] = shortMatch[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  throw new Error(`${path} 必须是十六进制颜色（#RGB 或 #RRGGBB），实际收到 "${value}"。`);
}

export function toPptxHexColor(value: string, path: string): string {
  return assertCanonicalHexColor(value, path).slice(1);
}
