import {
  RESEARCH_AGENT_ID,
  SubmitResearchDocumentArgsSchema,
  SubmitResearchDocumentToolOutputSchema,
  type ResearchRunArtifact,
} from '@app/schemas';
import {
  BaseTool,
  type ToolContext,
  type ToolParameterSchema,
  type LinnyaToolSchemaContext,
} from '../../../../tools/types';

export function serializeResearchDocumentSubmission(data: ResearchRunArtifact): string {
  const navigation = `已保存阶段文档：[${data.stage}](${data.path})。保存不表示内容已通过质量验收。`;
  return JSON.stringify(
    SubmitResearchDocumentToolOutputSchema.parse({
      data,
      observation: navigation,
      ...('subrun_id' in data ? { control: { terminateRun: true, finalAnswer: navigation } } : {}),
    })
  );
}

/** 共用 create-only 出口。保存父稿继续研究，提交 child 产物才结束该 child。 */
export class SubmitResearchDocumentTool extends BaseTool {
  readonly name = 'submit_research_document';
  readonly description =
    '保存完整 Markdown 研究文稿。父 Agent 提供 stage、input_documents、content，保存后继续工作；child 只提供 content，成功后结束自身任务。Host 决定新路径并核对依赖版本。格式或引用错误请修正后重新提交；不能用普通回答代替保存。' +
    '[@ref] 必须是当前实际作者正式取得的引用；read_file 的 [#ref] 是块定位符，不能改成 [@ref]。只有 Workspace 依据时保留真实文件链接与章节、行号或摘录。';
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      content: {
        type: 'string',
        minLength: 1,
        description: '完整 Markdown 正文，不能只含空白；使用当前作者正式取得的引用。',
      },
      stage: {
        type: 'string',
        enum: ['investigation', 'draft', 'revision'],
        description: '仅父 Agent：调查主记录、初稿或一次修订。',
      },
      input_documents: {
        type: 'array',
        items: { type: 'string', minLength: 1, description: '正式 Workspace 文档 locator。' },
        description:
          '仅父 Agent：本稿依赖的 Workspace 文档，不得重复。初稿包含自己的调查记录；修订包含同版初稿、相同上下文的两份原始评审及调查记录。',
      },
    },
    required: ['content'],
  };
  getParametersForContext(context: LinnyaToolSchemaContext): ToolParameterSchema {
    if (context.callerAgentId === RESEARCH_AGENT_ID)
      return { ...this.parameters, required: ['stage', 'input_documents', 'content'] };
    return {
      ...this.parameters,
      properties: { content: this.parameters.properties.content },
      required: ['content'],
    };
  }
  protected override validateArguments(args: Record<string, unknown>) {
    const parsed = SubmitResearchDocumentArgsSchema.safeParse(args);
    return parsed.success ? { success: true } : { success: false, error: parsed.error.message };
  }
  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const input = SubmitResearchDocumentArgsSchema.parse(args);
    if (!context.researchDocumentSubmission) throw new ResearchSubmissionScopeError();
    return serializeResearchDocumentSubmission(
      await context.researchDocumentSubmission(input, context)
    );
  }
}

export class ResearchSubmissionScopeError extends Error {
  readonly code = 'RESEARCH_SUBMISSION_SCOPE_REQUIRED';
  constructor() {
    super(
      'Only the admitted research author may submit its document with the matching parent or child parameters.'
    );
  }
}
