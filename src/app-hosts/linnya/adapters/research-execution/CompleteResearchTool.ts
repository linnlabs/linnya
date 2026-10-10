import {
  RESEARCH_AGENT_ID,
  CompleteResearchArgsSchema,
  CompleteResearchToolOutputSchema,
} from '@app/schemas';
import { BaseTool, type ToolContext, type ToolParameterSchema } from 'src/tools/types';

/** 只接纳真实交付证据；不启动 Agent、不评价观点，也不把自述变成核验状态。 */
export class CompleteResearchTool extends BaseTool {
  readonly name = 'complete_research';
  readonly description =
    '交付本次研究已保存的修订稿。核对调查、独立论证/来源评审与修订的真实提交和材料版本；不认证全文质量。提供正式提交返回的修订稿路径，不能提供初稿或模型自述的完成状态。成功后结束研究。';
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      document: {
        type: 'string',
        minLength: 1,
        description: '本次研究已提交修订稿的 workspace:/... 路径。',
      },
    },
    required: ['document'],
  };
  protected override validateArguments(args: Record<string, unknown>) {
    const result = CompleteResearchArgsSchema.safeParse(args);
    return result.success ? { success: true } : { success: false, error: result.error.message };
  }
  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const input = CompleteResearchArgsSchema.parse(args);
    if (context.callerAgentId !== RESEARCH_AGENT_ID || !context.researchCompletion)
      throw new Error('Only the admitted research lead can complete research.');
    const data = await context.researchCompletion(input.document);
    const reviewLinks = data.review_artifacts
      .map(
        review =>
          `[${review.stage === 'argument_review' ? '论证复核' : '来源与数字复核'}](${review.path})`
      )
      .join('、');
    const finalAnswer = `研究文章已保存：[打开修订稿](${data.artifact.path})。\n\n独立评审：${reviewLinks}。\n\n交接与版本检查完成；这不表示全文已经通过质量验收。`;
    return JSON.stringify(
      CompleteResearchToolOutputSchema.parse({
        data,
        observation: finalAnswer,
        control: { terminateRun: true, finalAnswer },
      })
    );
  }
}
