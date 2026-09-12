import { WorkspaceEditFileResultSchema, WorkspaceWriteFileResultSchema } from '@app/schemas';
import type { RoutedRuntimeEvent } from '@linnlabs/linnkit/contracts';
import type { ExecutionAuditWorkspaceDocumentFacts } from 'src/app-hosts/linnya/application/execution-audit-export';

/** 按工具公开合同接纳 data，不扫描任意插件结果，不读取 observation 或原始输出。 */
export function projectWorkspaceDocumentDiagnosticFacts(
  event: Extract<RoutedRuntimeEvent, { type: 'tool_output' }>,
): ExecutionAuditWorkspaceDocumentFacts | undefined {
  if (event.status !== 'success') return undefined;
  if (event.tool_name !== 'write_file' && event.tool_name !== 'edit_file') return undefined;
  const schema = event.tool_name === 'write_file'
    ? WorkspaceWriteFileResultSchema.shape.data
    : WorkspaceEditFileResultSchema.shape.data;
  const data = schema.parse(event.data);
  return {
    toolName: event.tool_name,
    severities: (data.diagnostics ?? []).map(diagnostic => diagnostic.severity),
    truncatedCount: data.diagnosticsTruncatedCount ?? 0,
  };
}
