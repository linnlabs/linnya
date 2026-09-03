import type { SvgGraphicViewBox } from './svgGraphic';

export const SVG_GRAPHIC_ADMISSION_FAILURE_CODES = [
  'slides.svg.invalid_xml',
  'slides.svg.missing_viewbox',
  'slides.svg.unsupported_element',
  'slides.svg.unsupported_attribute',
  'slides.svg.external_reference_forbidden',
  'slides.svg.resource_limit_exceeded',
] as const;

export type SvgGraphicAdmissionFailureCode =
  (typeof SVG_GRAPHIC_ADMISSION_FAILURE_CODES)[number];

export interface SvgGraphicAdmissionPolicy {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxElements: number;
  readonly maxAttributes: number;
  readonly maxPathSegments: number;
  /** title/desc 元数据总字符数；首期不允许 text/tspan。 */
  readonly maxMetadataTextLength: number;
}

export interface SvgGraphicMetrics {
  readonly bytes: number;
  readonly elements: number;
  readonly attributes: number;
  readonly maxDepth: number;
  readonly pathSegments: number;
  readonly metadataTextLength: number;
  readonly elementNames: Readonly<Record<string, number>>;
}

export interface SvgGraphicFeatureFacts {
  readonly hasGradient: boolean;
  readonly hasMarker: boolean;
  readonly hasTransform: boolean;
}

export interface SvgGraphicAdmissionReport {
  readonly canonicalSvg: string;
  readonly contentHash: string;
  readonly viewBox: SvgGraphicViewBox;
  readonly metrics: SvgGraphicMetrics;
  readonly facts: SvgGraphicFeatureFacts;
}

export class SvgGraphicAdmissionError extends Error {
  readonly name = 'SvgGraphicAdmissionError';

  constructor(
    readonly code: SvgGraphicAdmissionFailureCode,
    message: string,
    readonly elementPath?: string
  ) {
    super(message);
  }
}

/**
 * 预算来自 Phase 0 对 561 份 ppt-master SVG 的测量。
 * 已通过样本的峰值约 18 KiB、125 元素、664 属性、375 path segments；
 * 这里保留数倍余量，同时拒绝把嵌入位图伪装成 SVG Graphic。
 */
export const DEFAULT_SVG_GRAPHIC_ADMISSION_POLICY: SvgGraphicAdmissionPolicy = {
  maxBytes: 64 * 1024,
  maxDepth: 16,
  maxElements: 512,
  maxAttributes: 4_096,
  maxPathSegments: 2_048,
  maxMetadataTextLength: 4_096,
};
