import { z, ZodObject, ZodRawShape } from 'zod';

/**
 * @file src/plugin-sdk/types.ts
 *
 * @brief [核心合同] 定义了所有 Agent 工具必须遵守的接口和基类。
 *
 * @description
 * 此文件是整个工具生态系统的基础。它定义了 'Tool' 抽象类，
 * 任何想要成为 Agent 可用工具的功能模块，都必须实现这个类。
 * 工具参数由 Zod 定义，注册和执行必须遵循当前 Plugin SDK 合同。
 */

/**
 * Tool 的抽象基类。所有工具都必须继承自此类。
 * @template T - 参数的 Zod Schema 类型。
 */
export abstract class Tool<T extends ZodRawShape = ZodRawShape> {
  /**
   * 工具的唯一名称。必须是字母、数字和下划线的组合。
   * LLM 将使用此名称来识别和调用工具。
   * e.g., "knowledge_search"
   */
  abstract readonly name: string;

  /**
   * 对工具功能的清晰、简洁的描述。
   * 这段描述会直接展示给 LLM，帮助它理解工具的用途，从而决定何时使用它。
   */
  abstract readonly description: string;

  /**
   * 使用 Zod 定义工具的输入参数。
   * Zod Schema 将被自动转换成 LLM 可理解的 JSON Schema。
   * 同时，它也将在运行时用于验证 Agent 传递的参数。
   * 
   * @example
   * ```ts
   * parameters = z.object({
   *  query: z.string().describe('The search query'),
   *  k: z.number().optional().describe('Number of results to return')
   * });
   * ```
   */
  abstract readonly parameters: ZodObject<T>;

  /**
   * 工具的核心执行逻辑。
   * @param args - 经过 Zod Schema 验证和类型推断的参数对象。
   * @param context - [可选] 工具执行时可能需要的上下文信息，如用户ID、会话ID等。
   * @returns 工具执行的结果。这个结果将被序列化并返回给 LLM。
   */
  abstract run(
    args: z.infer<ZodObject<T>>,
    context?: unknown
  ): Promise<unknown>;
}
