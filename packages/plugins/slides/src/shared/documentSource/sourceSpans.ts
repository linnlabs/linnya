export interface SlideSourceSpan {
  startLine: number;
  endLine: number;
}

export interface SlidesSourceSliceTargetInput {
  elementId: string;
  slideNumber: number;
  kind: string;
  sourceSpan: SlideSourceSpan;
}

export type SlidesSourceOrigin = 'compiled' | 'draft';

export interface SlidesDraftStatus {
  baseVersionId: string;
  baseVersionNumber: number;
  errorKind?: string;
  errorSummary?: string;
  updatedAt: number;
}

/**
 * Slides 文档当前源码与可渲染物化之间的关系。
 *
 * draft 不是一次 IPC 异常，而是“源码已保存、当前物化仍停留在基线版本”的正式状态。
 */
export type SlidesDocumentBuildState =
  | {
      readonly state: 'ready';
      readonly presentationId: string;
      readonly versionId: string;
      readonly versionNumber: number;
    }
  | {
      readonly state: 'draft';
      readonly presentationId: string;
      readonly versionId: string;
      readonly versionNumber: number;
      readonly draftStatus: SlidesDraftStatus;
    };

export interface SlidesSourceSlicesInput {
  presentation_id: string;
  targets: SlidesSourceSliceTargetInput[];
}

export interface SlidesSourceSliceOutput {
  elementId: string;
  slideNumber: number;
  kind: string;
  sourceSpan: SlideSourceSpan;
  startLine: number;
  endLine: number;
  numLines: number;
  content: string;
}

export interface SlidesSourceSlicesOutput {
  presentationId: string;
  title: string;
  versionId: string;
  sourceOrigin: SlidesSourceOrigin;
  sourceKey: string;
  draftStatus?: SlidesDraftStatus;
  totalLines: number;
  slices: SlidesSourceSliceOutput[];
}
