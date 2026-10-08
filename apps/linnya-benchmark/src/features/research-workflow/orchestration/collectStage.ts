import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  WorkspaceWriteFileResultSchema,
  WorkspaceEditFileResultSchema,
  type ConversationUiMessage,
} from '@app/schemas';
import {
  ProjectionSchema,
  type Projection,
  type ResearchStage,
  type ResearchToolMessage,
  type ResearchWorkflowCliPort,
  type StageState,
} from '../definitions/researchWorkflow';
import { auditScope, hashText } from '../functions/workflowFacts';
import { collectSourceRecords, renderSourcePacket } from '../functions/sourcePacket';
import { writeJson } from '../adapters/workflowFiles';
import { readProjection } from './readProjection';

export async function collectMessages(
  cli: ResearchWorkflowCliPort,
  conversationId: string,
  runId: string
) {
  const messages = new Map<string, ConversationUiMessage>();
  const cursors = new Set<number>();
  let before: number | undefined;
  while (true) {
    const page = await cli.messagePage(conversationId, before);
    if (page.status !== 'ready')
      throw new Error('Message projection is preparing; retry collection on the same run');
    for (const message of page.messages) {
      // 隐藏推理不是研究资产；原始工具输入/输出和用户/最终文本足以审计执行。
      if (message.run_id === runId && message.message_type !== 'thought')
        messages.set(message.message_id, message);
    }
    if (!page.has_more_before) break;
    if (page.prev_cursor === undefined || cursors.has(page.prev_cursor))
      throw new Error('Message cursor failed to advance');
    before = page.prev_cursor;
    cursors.add(before);
  }
  return [...messages.values()].sort((a, b) => a.sort_seq - b.sort_seq);
}

interface CollectionContext {
  cli: ResearchWorkflowCliPort;
  output: string;
  record: (message: ResearchToolMessage) => Promise<void>;
  inspectionConversationId?: string;
  protectedLocators: readonly string[];
}
const PublicationSchema = z
  .object({
    locator: z.string(),
    contentHash: z.string(),
    status: z.enum(['writing', 'complete']),
    projection: ProjectionSchema.optional(),
  })
  .strict();
type Publication = z.infer<typeof PublicationSchema>;

async function loadPublications(file: string): Promise<Publication[]> {
  try {
    return z.array(PublicationSchema).parse(JSON.parse(await readFile(file, 'utf8')));
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}
export async function collectStage(
  context: CollectionContext,
  stage: ResearchStage,
  state: StageState,
  allowed: readonly string[]
): Promise<{ outputs: Projection[]; packetDocuments: Projection[] }> {
  if (!state.receipt) throw new Error('Cannot collect an unadmitted stage');
  const { conversation_id: conversationId, run_id: runId } = state.receipt;
  const directory = path.join(context.output, stage.id);
  const messages = await collectMessages(context.cli, conversationId, runId);
  await writeJson(path.join(directory, 'messages.json'), messages);
  await writeJson(path.join(directory, 'scope-audit.json'), auditScope(messages, stage, allowed));
  const result = await context.cli.result(conversationId, runId);
  await writeJson(path.join(directory, 'result.json'), result);
  try {
    await writeJson(
      path.join(directory, 'audit.json'),
      await context.cli.audit(conversationId, runId)
    );
  } catch (error: unknown) {
    await writeJson(path.join(directory, 'audit.json'), {
      status: 'unavailable',
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const sources = collectSourceRecords(messages);
  await writeJson(path.join(directory, 'source-records.json'), sources);
  const observedOutcome = state.status === 'collecting' ? 'completed' : state.status;
  if (result.outcome !== observedOutcome)
    throw new Error(`Terminal status/result mismatch: ${observedOutcome}/${result.outcome}`);
  if (result.outcome !== 'completed') return { outputs: [], packetDocuments: [] };
  const readContext = {
    cli: context.cli,
    projectId: state.projectId,
    conversationId: context.inspectionConversationId,
    record: context.record,
  };
  const outputs: Projection[] = [];
  for (const locator of stage.expectedDocuments) {
    const wrote = messages.some(message => {
      if (message.message_type !== 'tool_calls' || message.payload.status !== 'success')
        return false;
      const result = { data: message.payload.data, observation: message.content ?? '' };
      const parsed =
        message.payload.tool_name === 'write_file'
          ? WorkspaceWriteFileResultSchema.safeParse(result)
          : message.payload.tool_name === 'edit_file'
            ? WorkspaceEditFileResultSchema.safeParse(result)
            : undefined;
      return parsed?.success && parsed.data.data.locator === locator;
    });
    if (!wrote)
      throw new Error(`Expected document has no successful root write in this stage: ${locator}`);
    outputs.push(await readProjection(readContext, locator));
  }
  await writeJson(path.join(directory, 'outputs.json'), outputs);
  const packetDocuments: Projection[] = [];
  if (stage.sourcePacket) {
    const documents = renderSourcePacket(sources, stage.sourcePacket);
    const targets = documents.map(document => document.locator);
    if (
      new Set(targets).size !== targets.length ||
      targets.some(locator => context.protectedLocators.includes(locator))
    ) {
      throw new Error('Source publication targets overlap protected research documents');
    }
    await writeJson(path.join(directory, 'source-publication-plan.json'), documents);
    const journalFile = path.join(directory, 'source-publication-journal.json');
    const journal = await loadPublications(journalFile);
    for (const document of documents) {
      const prior = journal.find(item => item.locator === document.locator);
      if (prior) {
        if (prior.contentHash !== hashText(document.content))
          throw new Error(`Source publication plan changed: ${document.locator}`);
        const current = await readProjection(readContext, document.locator);
        if (prior.status === 'complete' && prior.projection?.sha256 !== current.sha256)
          throw new Error(`Published source changed: ${document.locator}`);
        if (
          prior.status === 'writing' &&
          (current.representation !== 'text' || current.text !== document.content)
        ) {
          throw new Error(
            `Source write outcome unknown; inspect without reissuing: ${document.locator}`
          );
        }
        prior.status = 'complete';
        prior.projection = current;
        await writeJson(journalFile, journal);
        packetDocuments.push(current);
        continue;
      }
      const publication: Publication = {
        locator: document.locator,
        contentHash: hashText(document.content),
        status: 'writing',
      };
      journal.push(publication);
      await writeJson(journalFile, journal);
      const message = await context.cli.workspaceTool({
        tool: 'write_file',
        projectId: state.projectId,
        conversationId: readContext.conversationId,
        args: document,
      });
      await context.record(message);
      readContext.conversationId = message.conversation_id;
      if (message.payload.status !== 'success')
        throw new Error(message.payload.error ?? `Source publication failed: ${document.locator}`);
      const projection = await readProjection(readContext, document.locator);
      if (projection.representation !== 'text' || projection.text !== document.content) {
        throw new Error(`Source publication did not preserve its frozen text: ${document.locator}`);
      }
      packetDocuments.push(projection);
      publication.status = 'complete';
      publication.projection = projection;
      await writeJson(journalFile, journal);
      await writeJson(path.join(directory, 'source-publications.json'), packetDocuments);
    }
    // 恢复可全部经过 journal 对账分支；最终导出必须包含这些已核对项，而非停在旧 checkpoint。
    await writeJson(path.join(directory, 'source-publications.json'), packetDocuments);
  }
  return { outputs, packetDocuments };
}
