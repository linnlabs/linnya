/**
 * @file src/tools/agent_control/ask/AskTool.ts
 *
 * @brief AI主动提问工具
 *
 * @description
 * 允许AI向用户提出结构化问题，支持单选、多选、文本输入等多种问题类型。
 * 这是一个创新的交互工具，解决用户需求表达不清晰的问题。
 *
 * 特性：
 * - 支持多种问题类型（单选、多选、文本）
 * - 每个问题最多7个选项
 * - 支持"其他"选项和自定义输入
 * - 用户可以提交答案或选择跳过
 * - 暂停Agent执行直到用户响应
 */

import {
  BaseTool,
  ToolContext,
  type ToolArgs,
  type ToolParameterProperty,
  type ToolParameterSchema,
} from '../../types';
import type { ToolControlInfo } from '../../types';
import type { StructuredToolResult } from '../../types';
import {
  AskResultSchema,
  QuestionnaireDataSchema,
  type QuestionnaireData,
} from '@app/schemas';
import {
  ASK_TOOL_MAX_OPTIONS,
  ASK_TOOL_MAX_QUESTIONS,
  ASK_TOOL_MIN_MULTI_SELECTIONS,
  AskToolInputSchema,
  type AskToolQuestion,
} from './definitions/askToolInput';
import { formatAskToolInputIssues } from './functions/formatAskToolInputIssues';

const QUESTION_BASE_PROPERTIES = {
  id: {
    type: 'string',
    minLength: 1,
    description: 'A unique non-empty identifier for the question.',
  },
  question: {
    type: 'string',
    minLength: 1,
    description: 'The non-empty text content of the question.',
  },
  required: {
    type: 'boolean',
    description: 'Whether the question must be answered before submission.',
  },
} satisfies Record<string, ToolParameterProperty>;

const QUESTION_OPTION_PROPERTY: ToolParameterProperty = {
  type: 'object',
  description: 'A selectable option.',
  properties: {
    id: {
      type: 'string',
      minLength: 1,
      description: 'A unique non-empty option identifier within the question.',
    },
    label: {
      type: 'string',
      minLength: 1,
      description: 'The non-empty option label shown to the user.',
    },
    description: {
      type: 'string',
      description: 'Optional supporting text for this option.',
    },
  },
  required: ['id', 'label'],
  additionalProperties: false,
};

const CHOICE_QUESTION_PROPERTIES = {
  ...QUESTION_BASE_PROPERTIES,
  options: {
    type: 'array',
    minItems: 1,
    maxItems: ASK_TOOL_MAX_OPTIONS,
    items: QUESTION_OPTION_PROPERTY,
    description: 'The selectable options. Provide between 1 and 7 unique options.',
  },
  allowOther: {
    type: 'boolean',
    description: 'Whether the UI adds an Other option with a custom text input.',
  },
} satisfies Record<string, ToolParameterProperty>;

const SINGLE_QUESTION_PROPERTY: ToolParameterProperty = {
  type: 'object',
  description: 'A single-choice question. Do not include maxSelect.',
  properties: {
    ...CHOICE_QUESTION_PROPERTIES,
    type: {
      type: 'string',
      enum: ['single'],
      description: 'The literal question type single.',
    },
  },
  required: ['id', 'type', 'question', 'options'],
  additionalProperties: false,
};

const MULTI_QUESTION_PROPERTY: ToolParameterProperty = {
  type: 'object',
  description: 'A multiple-choice question that may optionally cap selections.',
  properties: {
    ...CHOICE_QUESTION_PROPERTIES,
    type: {
      type: 'string',
      enum: ['multi'],
      description: 'The literal question type multi.',
    },
    maxSelect: {
      type: 'integer',
      minimum: ASK_TOOL_MIN_MULTI_SELECTIONS,
      maximum: ASK_TOOL_MAX_OPTIONS,
      description: 'Optional selection limit from 2 to 7, not exceeding the option count.',
    },
  },
  required: ['id', 'type', 'question', 'options'],
  additionalProperties: false,
};

const TEXT_QUESTION_PROPERTY: ToolParameterProperty = {
  type: 'object',
  description: 'A free-text question. Do not include options, allowOther, or maxSelect.',
  properties: {
    ...QUESTION_BASE_PROPERTIES,
    type: {
      type: 'string',
      enum: ['text'],
      description: 'The literal question type text.',
    },
  },
  required: ['id', 'type', 'question'],
  additionalProperties: false,
};

/**
 * AI提问工具类
 */
export class AskTool extends BaseTool {
  readonly name = 'ask';
  readonly streaming = {
    emitPlaceholder: true,
    emitArgumentSnapshots: true,
  } as const;

  readonly description = `Asks the user structured questions to obtain more accurate input.

# When to use this tool
- When the user's request is not clear or specific enough.
- When you need to understand the user's specific preferences or choices.
- When you want to collect detailed information from the user to provide better suggestions.
- When you need the user to make a choice from multiple options.
- When you are uncertain or not confident based on the information you have, use this tool to ask for clarification instead of guessing or making assumptions.

# Usage Strategy
- Questions should be concise and clear, avoiding excessive complexity.
- Limit the number of options to 7 or fewer (Max 7 options).
- Choose the appropriate question type (single/multi/text) based on the situation.
- Set required=true for important questions.
- Provide clear question descriptions and option labels.
- For single/multi-choice questions, set allowOther=true to automatically add an "Other" option for custom user input.
`;

  /** 提供给模型的 JSON Schema；正式 admission 由 AskToolInputSchema 承担。 */
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        minItems: 1,
        maxItems: ASK_TOOL_MAX_QUESTIONS,
        items: {
          type: 'object',
          description: 'One question, selected from the exact question-type contracts.',
          oneOf: [
            SINGLE_QUESTION_PROPERTY,
            MULTI_QUESTION_PROPERTY,
            TEXT_QUESTION_PROPERTY,
          ],
        },
        description: 'A questionnaire containing between 1 and 10 questions.',
      },
      title: {
        type: 'string',
        description: 'Optional questionnaire title.',
      },
      description: {
        type: 'string',
        description: 'Optional questionnaire description.',
      },
      submitLabel: {
        type: 'string',
        description: 'Optional submit button label. Defaults to Submit.',
      },
    },
    required: ['questions'],
    additionalProperties: false,
  };

  protected override validateArguments(args: Record<string, unknown>): {
    success: boolean;
    error?: string;
  } {
    const parsed = AskToolInputSchema.safeParse(args);
    return parsed.success
      ? { success: true }
      : { success: false, error: formatAskToolInputIssues(parsed.error.issues) };
  }

  /**
   * 执行问卷工具
   */
  async run(args: ToolArgs, _context: ToolContext): Promise<string> {
    /**
     * ✅ 失败语义（强制）：
     * - 工具执行失败时必须 throw，由执行层将 tool_output.status 标记为 error
     * - 禁止“返回一个看似成功的 JSON，但 data.error=xxx”的方式伪装成功
     *
     * 根因说明：
     * - ask 这类交互工具一旦失败仍返回 JSON，前端会继续走正常渲染链路；
     * - 这会导致“超出选项数量等校验失败”也渲染出问卷卡片，语义不一致。
     */
    const parsedInput = AskToolInputSchema.safeParse(args);
    if (!parsedInput.success) {
      const errorMsg = formatAskToolInputIssues(parsedInput.error.issues);
      console.error('[AskTool] Validation failed:', errorMsg);
      throw new Error(errorMsg);
    }
    const input = parsedInput.data;
    const { questions, title, description, submitLabel } = input;

    // 生成问卷ID
    const questionnaireId = `qn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 构建问卷数据
    const questionnaireData: QuestionnaireData = QuestionnaireDataSchema.parse({
      questionnaireId,
      title,
      description,
      allowSkip: true, // 用户必须有拒绝回答的权利
      submitLabel: submitLabel?.trim() || '提交',
      // 固定为“跳过”，不开放自定义：减少无意义参数，保持交互一致性
      skipLabel: '跳过',
      questions: this.processQuestions(questions),
    });

    // 构建控制信息
    const controlInfo: ToolControlInfo = {
      requireUser: true,
      questionnaireId,
      resumeStrategy: 'continue',
    };

    // 构建结构化结果
    const result: StructuredToolResult<QuestionnaireData> & { control: ToolControlInfo } =
      AskResultSchema.parse({
        data: questionnaireData,
        observation: `Agent execution paused. Waiting for user to respond to questionnaire (ID: ${questionnaireId}).`,
        control: controlInfo,
      });

    console.log(
      `[AskTool] Questionnaire created successfully: ${questionnaireId}, ${questions.length} questions`
    );

    return JSON.stringify(result);
  }

  /**
   * 处理和规范化问题数据
   */
  private processQuestions(questions: AskToolQuestion[]): AskToolQuestion[] {
    return questions.map(q => {
      if (q.type === 'text') {
        return {
          id: q.id,
          type: q.type,
          question: q.question,
          required: q.required ?? false,
        };
      }

      const options = q.options || [];

      // 自动过滤AI可能添加的“其他”选项，并强制启用系统的“其他”功能
      const otherOptionKeywords = ['other', '其它', '其他'];

      const filteredOptions = options.filter(
        opt => !otherOptionKeywords.includes(opt.label.toLowerCase().trim())
      );

      const wasOtherFiltered = options.length > filteredOptions.length;

      const choiceQuestion = {
        id: q.id,
        type: q.type,
        question: q.question,
        options: filteredOptions,
        allowOther: q.allowOther === true || wasOtherFiltered,
        required: q.required ?? false,
      };

      return q.type === 'multi'
        ? { ...choiceQuestion, type: 'multi', maxSelect: q.maxSelect }
        : { ...choiceQuestion, type: 'single' };
    });
  }

  /**
   * 获取执行摘要
   */
  getExecutionSummary(output: string): string {
    try {
      const parsed = JSON.parse(output);
      if (parsed.data?.questionnaireId) {
        const questionCount = parsed.data.questions?.length || 0;
        return `Asked user ${questionCount} questions, questionnaire ID: ${parsed.data.questionnaireId}`;
      }
      return 'Create user questionnaire';
    } catch {
      return 'Failed to create questionnaire or parse result';
    }
  }
}
