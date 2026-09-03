import {
  buildInspectionObservation,
  type DiagnosticToolFeedbackPayload,
} from '../features/presentationInspection';

export interface PptInspectObservationData extends DiagnosticToolFeedbackPayload {
  readonly presentationId: string;
  readonly slideCount: number;
  readonly truncated?: boolean;
}

/**
 * ppt_inspect 只承担布局诊断；源码原文和页面组织由 read_file 提供。
 * 这里直接复用 inspection 领域的标准化 finding 投影，避免工具层维护第二套摘要语义。
 */
export function buildInspectObservation(data: PptInspectObservationData): string {
  return buildInspectionObservation({
    presentationId: data.presentationId,
    versionId: data.artifact.versionId,
    totalSlideCount: data.slideCount,
    shownSlideNumbers: data.pageSummaries.map((page) => page.slideNumber),
    truncated: data.truncated === true,
    feedback: data,
  });
}
