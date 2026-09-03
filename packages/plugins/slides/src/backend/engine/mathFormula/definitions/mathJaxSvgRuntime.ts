export interface MathJaxSvgRuntimeRequest {
  readonly mathMl: string;
  readonly display: boolean;
  readonly color: string;
  readonly altText: string;
  readonly paddingUnits: number;
}

export interface MathJaxSvgRuntimeProjection {
  readonly canonicalSvg: string;
  readonly viewBox: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly contentViewBox: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}
