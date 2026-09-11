import {
  getDiagnosticAction,
  projectDiagnosticFindings,
  summarizeDiagnosticProjection,
  type PresentationInspectionResult,
} from '../../presentationInspection';
import {
  classifyDiagnosticPriority,
  getDiagnosticCodePolicy,
} from '../../../engine/quality/definitions';
import {
  SLIDES_CLI_REPORT_KIND,
  SLIDES_CLI_REPORT_VERSION,
  SLIDES_CLI_VERSION,
  type SlidesCliInspectionReport,
} from '../definitions/slidesCli';

/**
 * CLI inspect 是 ppt_inspect 的机器可读投影：保留完整 finding，
 * 不再复制 read_file 已能提供的页面结构和大体积文本布局归因。
 */
export function buildSlidesCliInspectionReport(
  inspection: PresentationInspectionResult,
): SlidesCliInspectionReport {
  const { renderModel, feedback } = inspection;
  const projection = projectDiagnosticFindings(feedback.findings);
  return {
    kind: SLIDES_CLI_REPORT_KIND,
    schemaVersion: SLIDES_CLI_REPORT_VERSION,
    cliVersion: SLIDES_CLI_VERSION,
    presentation: {
      id: renderModel.presentationId,
      title: renderModel.title,
      versionId: inspection.versionId,
      versionNumber: renderModel.version,
      sourceKind: renderModel.sourceKind,
    },
    slideSize: renderModel.slideSize,
    totalSlideCount: inspection.totalSlideCount,
    requestedSlideNumbers: [...inspection.requestedSlideNumbers],
    shownSlideNumbers: feedback.pageSummaries.map((page) => page.slideNumber),
    truncated: inspection.truncated,
    buildStatus: { ...feedback.buildStatus },
    findingSummary: summarizeDiagnosticProjection(projection),
    rootGroups: projection.rootGroups.map((group) => ({
      basis: group.basis,
      key: group.key,
      priority: group.priority,
      ...(group.basis === 'declared_root'
        ? { rootFindingId: group.root.findingId }
        : {}),
      findingIds: group.findings.map((finding) => finding.findingId),
    })),
    ...(feedback.focus ? { focus: feedback.focus } : {}),
    findings: projection.findings.map((finding) => {
      const policy = getDiagnosticCodePolicy(finding.code);
      return {
        ...finding,
        action: getDiagnosticAction(finding.code),
        scope: policy.scope,
        category: policy.category,
        priority: classifyDiagnosticPriority(finding),
      };
    }),
  };
}
