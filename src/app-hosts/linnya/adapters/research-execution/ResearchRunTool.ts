import { ResearchRunArgsSchema, ResearchRunDataSchema } from '@app/schemas';
import { BaseTool, type ToolContext, type ToolParameterSchema } from 'src/tools/types';

/** Host-only 薄入口；流程、版本接纳和文件写入分别由应用用例和 owner adapter 承担。 */
export class ResearchRunTool extends BaseTool {
  readonly name = 'research_run';
  readonly description = '系统专用：执行已接纳的调查、独立复核和一次修订，并保存研究文档。';
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      question: { type: 'string', minLength: 1, description: '研究问题与交付要求。' },
      reader: { type: 'string', minLength: 1, description: '目标读者。' },
      task_type: { type: 'string', enum: ['open', 'fixed', 'update'], description: '开放研究、固定材料或更新已有研究。' },
      materials: { type: 'array', items: { type: 'string', minLength: 1, description: '正式 Workspace 文档路径。' }, description: '正式 workspace:/ 材料路径；固定/更新研究至少一份。' },
      time_range: { type: 'string', minLength: 1, description: '适用时间范围。' },
    },
    required: ['question', 'reader', 'task_type', 'materials'], additionalProperties: false,
  };
  protected override validateArguments(args: Record<string, unknown>): { success: boolean; error?: string } {
    const parsed = ResearchRunArgsSchema.safeParse(args);
    return parsed.success ? { success: true } : { success: false,
      error: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') };
  }
  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const input = ResearchRunArgsSchema.parse(args);
    if (!context.researchExecution) throw new Error('Research execution port is not installed');
    const data = ResearchRunDataSchema.parse(await context.researchExecution(input));
    const article = data.artifacts.find(item => item.stage === 'revision');
    const observation = data.status === 'delivered' && article
      ? `研究阶段已完成，修订稿：[打开文章](${article.path})。调查、原始评审和初稿分别保存在项目中。阶段完成不代表所有结论已核实。`
      : `输入文档已经变化，停止后继研究。已保留候选稿和旧版本绑定，请核对材料后重新发起研究。变化：${data.status === 'inputs_changed' ? data.changed_paths.join('、') : ''}`;
    return JSON.stringify({ data, observation, control: { terminateRun: true, finalAnswer: observation } });
  }
}
