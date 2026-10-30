import path from 'node:path';
import { z } from 'zod';
import { CommandRunPermissionSnapshotV1Schema } from '@app/schemas/commands';
import { BaseTool, type PluginToolContext, type StructuredToolResult, type ToolParameterSchema } from '@plugin/backend/toolRuntime';
import { isPluginRuntimeEnabled } from '@plugin/backend/pluginRuntime';
import { createConversationFilePathResolver } from '@plugin/backend/workspaceRuntime';
import { createDecisionRecordRepository, renderDecisionDelivery, writeDecisionArtifact } from '../decision-record';

const argumentsSchema = z.object({ decisionId: z.string().uuid(), expectedRevision: z.number().int().positive() }).strict();
const permissionSchema = z.object({ status: z.literal('available'), snapshot: CommandRunPermissionSnapshotV1Schema });

/** 只接收保存版身份；最终文本由程序生成，不接受作者再提交一份答复。 */
export class DecisionFinishTool extends BaseTool {
  readonly name = 'decision_finish';
  readonly description = 'Deliver the current saved Decision recommendation with program-computed values and an original-file link, then finish this run. Save or update the recommendation through linnya-decision first. This does not perform an external action or certify the model. Input only the record ID and current revision.';
  readonly parameters: ToolParameterSchema = {
    type: 'object', properties: {
      decisionId: { type: 'string', description: 'Decision record ID returned by the CLI in this project.' },
      expectedRevision: { type: 'integer', description: 'Current saved revision to deliver.' },
    }, required: ['decisionId', 'expectedRevision'], additionalProperties: false,
  };

  async run(args: Record<string, unknown>, context: PluginToolContext): Promise<string> {
    const input = argumentsSchema.parse(args);
    if (!isPluginRuntimeEnabled('decision')) throw new Error('Decision plugin is disabled.');
    // 与 CLI 保持同一冻结权限边界，不能借新收口入口绕过内部数据或文件写权限。
    const permission = permissionSchema.safeParse(Reflect.get(context, 'commandRunPermission'));
    if (!permission.success || permission.data.snapshot.internal_data_access !== 'allowed'
      || permission.data.snapshot.permission_level === 'read_only') {
      throw new Error('Decision delivery requires internal-data access and conversation-file write permission.');
    }
    const { workspaceProjectId, databaseService, conversationId, abortSignal } = context;
    const files = createConversationFilePathResolver(context);
    if (!workspaceProjectId || !databaseService || !conversationId || !abortSignal || !files) {
      throw new Error('Decision delivery requires an active project conversation and its file capability.');
    }
    abortSignal.throwIfAborted();
    // 路径由 Host 准入并限定当前会话；不从模型参数、磁盘数据库路径推断作用域。
    const root = path.dirname(await files.resolveRelativePath({ conversationId, relativePath: 'decision-delivery' }));
    abortSignal.throwIfAborted();
    const record = createDecisionRecordRepository(databaseService.getDb(), workspaceProjectId).read(input.decisionId);
    const delivery = renderDecisionDelivery(record, input.expectedRevision);
    const receipt = await writeDecisionArtifact(root, delivery, abortSignal);
    const finalAnswer = `${delivery.markdown}\n---\n\n${receipt.deliveryNote}`;
    const result: StructuredToolResult<typeof receipt> = {
      data: receipt,
      observation: `已生成记录 ${receipt.decisionId} 第 ${receipt.revision} 版交付。${receipt.artifact.markdownLink}`,
      control: { finalAnswer, terminateRun: true, reason: 'Decision saved-version delivery completed.' },
    };
    return JSON.stringify(result);
  }
}
