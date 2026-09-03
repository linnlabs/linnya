export type SvgPhase0FailureCode =
  | 'slides.svg.invalid_xml'
  | 'slides.svg.missing_viewbox'
  | 'slides.svg.unsupported_element'
  | 'slides.svg.unsupported_attribute'
  | 'slides.svg.external_reference_forbidden'
  | 'slides.svg.resource_limit_exceeded';

export interface SvgPhase0AdmissionPolicy {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxElements: number;
  readonly maxAttributes: number;
  readonly maxPathSegments: number;
  readonly maxTextLength: number;
}

export interface SvgPhase0Metrics {
  readonly bytes: number;
  readonly elements: number;
  readonly attributes: number;
  readonly maxDepth: number;
  readonly pathSegments: number;
  readonly textLength: number;
  readonly elementNames: Readonly<Record<string, number>>;
}

export interface SvgPhase0AdmissionReport {
  readonly canonicalSvg: string;
  readonly contentHash: string;
  readonly viewBox: {
    readonly width: number;
    readonly height: number;
  };
  readonly metrics: SvgPhase0Metrics;
  readonly facts: {
    readonly hasText: boolean;
    readonly hasGradient: boolean;
    readonly hasMarker: boolean;
    readonly hasTransform: boolean;
  };
}

/**
 * Phase 0 预算基于 ppt-master 561 份 SVG 样本冻结。
 * 通过 admission 的纯矢量样本最大约 18 KiB、125 元素、664 属性、375 路径段；
 * 这里保留数倍余量，但不接纳由 base64 图片制造的多 MiB “伪矢量”。
 */
export const SVG_PHASE_0_PROTOTYPE_POLICY: SvgPhase0AdmissionPolicy = {
  maxBytes: 64 * 1024,
  maxDepth: 16,
  maxElements: 512,
  maxAttributes: 4_096,
  maxPathSegments: 2_048,
  maxTextLength: 4_096,
};

export class SvgPhase0AdmissionError extends Error {
  constructor(
    readonly code: SvgPhase0FailureCode,
    message: string,
    readonly elementPath?: string
  ) {
    super(message);
    this.name = 'SvgPhase0AdmissionError';
  }
}

export function unsupportedSvgPhase0Attribute(
  path: string,
  attributeName: string,
  detail: string
): SvgPhase0AdmissionError {
  return new SvgPhase0AdmissionError(
    'slides.svg.unsupported_attribute',
    `${path}/@${attributeName}: ${detail}`,
    path
  );
}
