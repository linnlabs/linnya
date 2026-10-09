/**
 * @file src/tools/agent_control/subrun/subagent/subagentTool.ts
 * @description Linnya 通用子 Agent 协作工具 facade。
 */

import { SubagentArgsSchema, SubagentResultSchema, type SubagentResult } from '@app/schemas';
import { getRegisteredSubagentTypes } from 'src/app-hosts/linnya/plugin-registry/builtin';
import type { SubagentTypeContribution } from 'src/app-hosts/linnya/plugin-registry/types';

import {
  BaseTool,
  type ToolContext,
  type ToolParameterSchema,
  type LinnyaToolSchemaContext,
} from '../../../types';
import { deriveSubagentStatus } from './functions/deriveSubagentStatus';
import { extractSubagentArtifactRefs } from './functions/extractSubagentArtifactRefs';
import { resolveSubagentType } from './functions/resolveSubagentType';
import { filterSubagentTypes } from './functions/filterSubagentTypes';
import { runRegisteredSubagent } from '../shared';

function listSubagentTypes(context: LinnyaToolSchemaContext = {}): SubagentTypeContribution[] {
  return filterSubagentTypes(
    getRegisteredSubagentTypes(),
    context.callerAgentId,
    context.availableSubagentTypes
  );
}

function buildSubagentTypeLines(context: LinnyaToolSchemaContext): string {
  return listSubagentTypes(context)
    .map(
      item =>
        `- **${item.type}**${item.type === 'general' ? ' (default)' : ''}: ${item.description}`
    )
    .join('\n');
}

function buildSubagentDescription(context: LinnyaToolSchemaContext = {}): string {
  return `Create a specialized subagent to perform a subtask. Choose the right subagent_type for the task:

${buildSubagentTypeLines(context)}

Important:
- The subagent runs in an isolated executor (no persistence into the parent timeline).
- Subagents cannot call subagent recursively.
- Subagents automatically receive the admitted project/current-view environment, but not the parent conversation history or TaskState. The prompt is the parent's task instruction; include the goal, task-specific inputs, allowed and forbidden sources/actions, and expected output. Pass on all applicable user restrictions; inherited command permissions do not replace task-specific restrictions. Use input_documents for explicit Workspace materials. The Host may bind these materials and append role-specific delivery requirements to the actual child request.
- Follow the selected role's delivery requirements. If the role has no specific delivery contract, prefer findings in its final answer, then compose the final output yourself.
- If durable output is needed, use the selected role's document delivery contract, or ask a role with Workspace write tools to create or edit files.
- The tool returns \`status\` plus reusable \`artifacts\`: Workspace VFS inodes (\`workspace:<nodeId>\`) and durable ToolOutput references (\`tool_output://blobs/<id>\`). Read Workspace artifacts with \`read_file(inode=..., view="document")\`; continue ToolOutput artifacts with \`tool_output_read(blob_id=...)\`.
`;
}

function formatSubagentOutcome(
  status: SubagentResult['data']['status'],
  description: string
): string {
  if (status === 'completed') return `subagent 子任务已完成：${description}`;
  if (status === 'partial') return `subagent 子任务部分完成：${description}`;
  if (status === 'cancelled') return `subagent 子任务已取消：${description}`;
  return `subagent 子任务失败：${description}`;
}

function requireExecutionModelId(context: ToolContext): string {
  const modelId = context.modelId?.trim();
  if (!modelId) {
    throw new Error('subagent: context.modelId is required');
  }
  return modelId;
}

export class SubagentTool extends BaseTool {
  readonly name = 'subagent';

  readonly description = buildSubagentDescription();

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      description: {
        type: 'string',
        minLength: 1,
        description: '子任务简短描述（用于 UI/定位）。建议 3~12 个字。',
      },
      prompt: {
        type: 'string',
        minLength: 1,
        description:
          '父 Agent 的委派指令：写明目标、任务专属输入、允许及禁止的来源/操作和预期输出，逐项传递适用的用户限制；项目、当前文档与文件清单由系统自动注入。Host 可按角色补充正式材料和交付要求。',
      },
      subagent_type: {
        type: 'string',
        minLength: 1,
        description: '子 Agent 类型。默认 general。',
        enum: listSubagentTypes().map(item => item.type),
      },
      input_documents: {
        type: 'array',
        minItems: 1,
        items: { type: 'string', minLength: 1, description: '正式 workspace:/ 文档路径。' },
        description:
          '显式绑定的 Workspace 材料列表；省略时仅传递父委派指令。它不表示文档已被 child 读取。',
      },
    },
    required: ['description', 'prompt'],
  };

  getDescriptionForContext(context: LinnyaToolSchemaContext = {}): string {
    return buildSubagentDescription(context);
  }

  isAvailableForContext(context: LinnyaToolSchemaContext): boolean {
    return listSubagentTypes(context).length > 0;
  }

  getParametersForContext(context: LinnyaToolSchemaContext = {}): ToolParameterSchema {
    const types = listSubagentTypes(context).map(item => item.type);
    if (types.length === 0) throw new Error('subagent: no types are available for this caller');
    const hasDefault = types.includes('general');
    return {
      ...this.parameters,
      required: hasDefault ? ['description', 'prompt'] : ['description', 'prompt', 'subagent_type'],
      properties: {
        ...this.parameters.properties,
        subagent_type: {
          ...this.parameters.properties.subagent_type,
          description: hasDefault ? '子 Agent 类型。默认 general。' : '本次委派的子 Agent 类型。',
          enum: types,
        },
      },
    };
  }

  protected override validateArguments(args: Record<string, unknown>) {
    const parsed = SubagentArgsSchema.safeParse(args);
    return parsed.success
      ? { success: true }
      : {
          success: false,
          error: parsed.error.issues
            .map(issue => `${issue.path.join('.')}: ${issue.message}`)
            .join('; '),
        };
  }

  getExecutionSummary(output: string): string {
    const { data } = SubagentResultSchema.parse(JSON.parse(output));
    if (data.status === 'completed') return `${data.description}：完成。`;
    if (data.status === 'partial') return `${data.description}：部分完成。`;
    if (data.status === 'cancelled') return `${data.description}：已取消。`;
    return `${data.description}：失败。`;
  }

  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const validation = this.validateArguments(args);
    if (!validation.success) {
      throw new Error(validation.error ?? 'subagent: invalid arguments');
    }
    const parsedArgs = SubagentArgsSchema.parse(args);
    const resolved = resolveSubagentType(parsedArgs.subagent_type, listSubagentTypes(context));
    const modelId = requireExecutionModelId(context);

    /**
     * ChildRunInvoker 只接收一个 userMessage。description 同时属于子任务输入与父卡片身份，
     * 因此这里显式合并，不能只把 prompt 传给 child 后再从 metadata 补猜。
     */
    const prepared = await context.prepareSubagentTask?.({
      args: parsedArgs,
      resolvedType: resolved,
      modelId,
    });
    const userMessage =
      prepared?.userMessage ??
      [
        parsedArgs.description,
        parsedArgs.prompt,
        ...(parsedArgs.input_documents
          ? [`Input documents:\n${parsedArgs.input_documents.join('\n')}`]
          : []),
      ].join('\n\n');
    const result = await runRegisteredSubagent({
      context: prepared?.context ?? context,
      promptKey: resolved.promptKey,
      description: parsedArgs.description,
      userMessage,
      // 默认隔离；确有角色语义需要时，由 subagent_type 注册方显式声明父历史策略。
      inheritTurns: resolved.inheritTurns,
      modelId,
      ...(prepared?.subrunId ? { subrunId: prepared.subrunId } : {}),
      subrunSource: `tool:subagent:${resolved.type}`,
      subrunMetadata: {
        subagent_description: parsedArgs.description,
        subagent_type: resolved.type,
      },
    });

    const finalAnswer = result.finalAnswer;
    const finalAnswerTrimmed = finalAnswer.trim();
    const lastProgress = result.lastProgress?.trim() || undefined;
    const error = result.error?.trim() || undefined;
    const acceptedArtifacts =
      prepared && result.success && !result.cancelled ? await prepared.acceptResult(result) : [];
    const artifacts = [
      ...new Set([...extractSubagentArtifactRefs(result.events), ...acceptedArtifacts]),
    ];
    const status = deriveSubagentStatus({
      cancelled: result.cancelled === true,
      error,
      finalAnswer,
      artifactCount: artifacts.length,
    });

    const observation = [
      formatSubagentOutcome(status, parsedArgs.description),
      `subagent_type=${resolved.type}`,
      `status=${status}`,
      ...(artifacts.length > 0 ? [`artifacts=${artifacts.join(', ')}`] : []),
      /**
       * 父 Agent 主要消费 observation；完整 child 过程由 subrun_trace 展示，Renderer 禁止
       * 从 final_answer 补造消息。超长 observation 的持久化和预览统一交给 ToolNode。
       */
      ...(finalAnswerTrimmed.length > 0 ? [`final_answer=\n${finalAnswerTrimmed}`] : []),
      ...(lastProgress ? [`last_progress=\n${lastProgress}`] : []),
      ...(error ? [`error=${error}`] : []),
    ].join('\n');

    const output: SubagentResult = {
      data: {
        description: parsedArgs.description,
        subagent_type: resolved.type,
        model_id: modelId,
        subrun_ids: [result.subrunId],
        status,
        final_answer: finalAnswer,
        artifacts,
        ...(lastProgress ? { last_progress: lastProgress } : {}),
        ...(error ? { error } : {}),
      },
      observation,
    };

    return JSON.stringify(SubagentResultSchema.parse(output), null, 2);
  }
}
