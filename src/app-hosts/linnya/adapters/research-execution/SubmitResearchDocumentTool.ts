import {
  SubmitResearchDocumentArgsSchema,
  SubmitResearchDocumentToolOutputSchema,
  type ResearchRunArtifact,
} from '@app/schemas';
import { BaseTool, type ToolContext, type ToolParameterSchema } from '../../../../tools/types';

export function serializeResearchDocumentSubmission(data: ResearchRunArtifact): string {
  const navigation = `已保存阶段文档：[${data.stage}](${data.path})。保存不表示内容已通过质量验收。`;
  return JSON.stringify(
    SubmitResearchDocumentToolOutputSchema.parse({
      data,
      observation: navigation,
      control: { terminateRun: true, finalAnswer: navigation },
    })
  );
}

/** 专用 create-only 出口；正文校验失败留在本 child，成功后才结束它。 */
export class SubmitResearchDocumentTool extends BaseTool {
  readonly name = 'submit_research_document';
  readonly description =
    '提交当前研究阶段的完整 Markdown 正文。Host 决定新文档路径；成功即结束本阶段。引用或格式错误会返回，请修改正文后再提交；不要用普通回答代替提交。' +
    '[@ref] 必须是当前 child 正式取得的来源引用；read_file 的 [#ref] 是块定位符，不能改成 [@ref]。仅有 Workspace 正文依据时，使用真实文件链接与章节、行号或摘录，不伪造来源引用。';
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      content: {
        type: 'string',
        minLength: 1,
        description:
          '完整 Markdown 正文，保留首尾空白但不能只含空白；使用当前 child 正式取得的引用。',
      },
    },
    required: ['content'],
  };
  protected override validateArguments(args: Record<string, unknown>) {
    const parsed = SubmitResearchDocumentArgsSchema.safeParse(args);
    return parsed.success ? { success: true } : { success: false, error: parsed.error.message };
  }
  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const input = SubmitResearchDocumentArgsSchema.parse(args);
    if (!context.researchDocumentSubmission) throw new ResearchSubmissionScopeError();
    return serializeResearchDocumentSubmission(
      await context.researchDocumentSubmission(input.content, context)
    );
  }
}

export class ResearchSubmissionScopeError extends Error {
  readonly code = 'RESEARCH_SUBMISSION_SCOPE_REQUIRED';
  constructor() {
    super('Only the prepared research child may submit its stage document.');
  }
}
