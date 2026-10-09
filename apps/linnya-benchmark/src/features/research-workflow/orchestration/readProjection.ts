import {
  WorkspaceReadFileEventResultSchema,
  type WorkspaceDocumentCitationSource,
} from '@app/schemas';
import type {
  Projection,
  ResearchToolMessage,
  ResearchWorkflowCliPort,
} from '../definitions/researchWorkflow';
import { buildProjection, citationSnapshots } from '../functions/projectionFacts';
import { textProjectionWindow } from '../functions/textProjectionWindow';
import {
  hasLegacyObservationTruncation,
  verifiedCitationDataRanges,
} from '../functions/observationDataRanges';

interface ReadContext {
  cli: ResearchWorkflowCliPort;
  projectId: string;
  conversationId?: string;
  record: (message: ResearchToolMessage) => Promise<void>;
}
class IncompleteWindow extends Error {}

function decode(message: ResearchToolMessage) {
  if (message.payload.status !== 'success')
    throw new Error(message.payload.error ?? message.content ?? 'Workspace read failed');
  return WorkspaceReadFileEventResultSchema.parse({
    data: message.payload.data,
    observation: message.content ?? '',
  });
}

/** 按实际 observation 校验范围，而不是把 owner 的 has_more 当作外层没有截断。 */
export async function readProjection(context: ReadContext, locator: string): Promise<Projection> {
  let offset = 1;
  let limit = 200;
  let total: number | undefined;
  let updatedAt: number | undefined;
  const lines: string[] = [];
  const sources: WorkspaceDocumentCitationSource[] = [];
  while (true) {
    const message = await context.cli.workspaceTool({
      tool: 'read_file',
      projectId: context.projectId,
      conversationId: context.conversationId,
      args: { locator, offset, limit },
    });
    await context.record(message);
    context.conversationId = message.conversation_id;
    const result = decode(message);
    if (result.data.source_kind !== 'workspace_vfs')
      throw new Error(`Expected Workspace text: ${locator}`);
    const data = result.data;
    if (updatedAt !== undefined && updatedAt !== data.node.updated_at)
      throw new Error(`Document changed while reading: ${locator}`);
    updatedAt = data.node.updated_at;
    if (total !== undefined && total !== data.total_line_count)
      throw new Error(`Document changed while reading: ${locator}`);
    total = data.total_line_count;
    if (total === 0) return buildProjection(locator, '', 'text', []);
    const window = textProjectionWindow({
      observation: result.observation,
      offset,
      lineCount: data.line_count,
      externallyTruncated: message.payload.observation_truncation !== undefined,
      sources: data.citations?.citations ?? [],
    });
    if (!window.complete) {
      if (limit > 1) {
        limit = Math.max(1, Math.floor(limit / 2));
        continue;
      }
      const document = await readDocumentProjection(context, locator);
      const after = await context.cli.workspaceTool({
        tool: 'read_file',
        projectId: context.projectId,
        conversationId: context.conversationId,
        args: { locator, offset: 1, limit: 1 },
      });
      await context.record(after);
      const check = decode(after);
      if (check.data.source_kind !== 'workspace_vfs' || check.data.node.updated_at !== updatedAt)
        throw new Error(`Document changed during DocumentView read: ${locator}`);
      return document;
    }
    lines.push(...window.lines);
    sources.push(...citationSnapshots(data.citations?.citations ?? []));
    offset += data.line_count;
    if (lines.length === total) return buildProjection(locator, lines.join('\n'), 'text', sources);
    if (!data.has_more || data.next_offset !== offset || data.line_count === 0)
      throw new IncompleteWindow(`Incomplete text window: ${locator}`);
  }
}

/** 单个超长行用正式 DocumentView 字符窗口读取，明确标记它不是普通文本序列化。 */
async function readDocumentProjection(context: ReadContext, locator: string): Promise<Projection> {
  let offset = 0;
  let total: number | undefined;
  let body = '';
  const sources: WorkspaceDocumentCitationSource[] = [];
  while (true) {
    const message = await context.cli.workspaceTool({
      tool: 'read_file',
      projectId: context.projectId,
      conversationId: context.conversationId,
      args: { locator, view: 'document', offset_chars: offset, max_chars: 4000 },
    });
    await context.record(message);
    context.conversationId = message.conversation_id;
    // 读取正式事件合同，不为历史工具消息捏造 live 工具的 preview metadata。
    const result = decode(message);
    if (result.data.source_kind !== 'workspace_document') throw new Error('Expected DocumentView');
    if (message.payload.observation_truncation !== undefined)
      throw new IncompleteWindow(`Truncated DocumentView envelope: ${locator}`);
    const document = result.data.document;
    if (total !== undefined && total !== document.totalTextLength)
      throw new Error(`Document changed while reading: ${locator}`);
    total = document.totalTextLength;
    const separator = result.observation.indexOf('\n---\n');
    if (separator < 0) throw new IncompleteWindow(`Truncated DocumentView envelope: ${locator}`);
    const end = document.nextOffset ?? total;
    const expected = end - offset;
    // 正文/引用都可能包含 XML 字面量。结束位置由实际字符窗口决定，不能搜索最后一个标签。
    const start = separator + 5;
    const text = result.observation.slice(start, start + expected);
    const suffix = `${document.truncatedByChars ? '... [truncated]' : ''}\n</workspace_document>`;
    if (text.length !== expected || !result.observation.startsWith(suffix, start + expected))
      throw new IncompleteWindow(`DocumentView range mismatch: ${locator}`);
    const dataRanges = verifiedCitationDataRanges(
      result.observation,
      result.data.citations?.citations ?? []
    );
    if (
      hasLegacyObservationTruncation(result.observation, [[start, start + expected], ...dataRanges])
    )
      throw new IncompleteWindow(`Truncated DocumentView envelope: ${locator}`);
    body += text;
    sources.push(...citationSnapshots(result.data.citations?.citations ?? []));
    if (end === total) return buildProjection(locator, body, 'document-view', sources);
    if (end <= offset)
      throw new IncompleteWindow(`DocumentView cursor did not advance: ${locator}`);
    offset = end;
  }
}
