import type { DocumentCitationDiagnostic } from '../definitions/documentCitationProjection';

/**
 * 诊断与来源使用同一 canonical body token 选择规则。
 * 这样分页边界不会把窗口外的损坏引用、manual source 或 excerpt 状态泄漏进当前结果。
 */
export function selectDocumentCitationDiagnosticsForBodyWindow(params: {
  readonly bodyWindow: string;
  readonly diagnostics: readonly DocumentCitationDiagnostic[];
}): readonly DocumentCitationDiagnostic[] {
  return params.diagnostics.filter(diagnostic =>
    params.bodyWindow.includes(diagnostic.bodyToken)
  );
}
