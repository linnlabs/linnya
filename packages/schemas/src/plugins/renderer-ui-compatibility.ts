import satisfies from 'semver/functions/satisfies.js';
import valid from 'semver/functions/valid.js';
import validRange from 'semver/ranges/valid.js';

export type RendererUiCompatibilityFailureReason =
  | 'invalid-host-version'
  | 'invalid-range'
  | 'not-satisfied';

export type RendererUiCompatibilityResult =
  | {
      readonly compatible: true;
      readonly hostVersion: string;
      readonly range: string;
    }
  | {
      readonly compatible: false;
      readonly hostVersion: string;
      readonly range: string;
      readonly reason: RendererUiCompatibilityFailureReason;
    };

/**
 * Renderer UI compatibility 统一使用 node-semver range grammar。
 * 这里不启用 loose 或 includePrerelease，避免构建期与运行期各自猜测版本语义。
 */
export function isValidRendererUiCompatibilityRange(range: string): boolean {
  const candidate = range.trim();
  return candidate.length > 0 && validRange(candidate) !== null;
}

export function evaluateRendererUiCompatibility(
  hostVersion: string,
  range: string,
): RendererUiCompatibilityResult {
  const normalizedHostVersion = hostVersion.trim();
  const normalizedRange = range.trim();

  if (valid(normalizedHostVersion) === null) {
    return {
      compatible: false,
      hostVersion: normalizedHostVersion,
      range: normalizedRange,
      reason: 'invalid-host-version',
    };
  }
  if (!isValidRendererUiCompatibilityRange(normalizedRange)) {
    return {
      compatible: false,
      hostVersion: normalizedHostVersion,
      range: normalizedRange,
      reason: 'invalid-range',
    };
  }
  if (!satisfies(normalizedHostVersion, normalizedRange)) {
    return {
      compatible: false,
      hostVersion: normalizedHostVersion,
      range: normalizedRange,
      reason: 'not-satisfied',
    };
  }
  return {
    compatible: true,
    hostVersion: normalizedHostVersion,
    range: normalizedRange,
  };
}
