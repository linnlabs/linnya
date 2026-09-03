/**
 * @file src/core/invoke-request.types.ts
 * @description Runtime Kernel 最小公共请求协议
 *
 * 设计目标：
 * - 只包含 core 层（graph-engine / system-reminder / enrichment）真正读取的字段
 * - features 层的 AgentInvokeRequest 通过 TypeScript 结构类型自然满足该接口（无需显式 extends）
 * - core 不再反向依赖 features 的请求类型定义
 *
 * 中文备注：
 * - 该接口是"冻结 Runtime 最小公共协议"的一部分（Phase 1）
 * - 新增字段必须确认是 core 层真正需要的，否则应放在 features 层的 AgentInvokeRequest 上
 */

import type { PromptKey } from '@app/schemas';
import type { AiMessage } from '@linnlabs/linnkit/contracts';

export interface CoreInvokeRequest {
  /** 用户查询 */
  query: string;

  /** 任务提示键（决定使用哪个任务模板 / enricher / stepPolicy） */
  promptKey: PromptKey;

  /** 使用的模型 ID */
  model_id?: string;

  /** 最大推理步数（覆盖 agent 默认值） */
  maxSteps?: number;

  /** 是否启用工具 */
  enableTools?: boolean;

  /** 可用工具白名单（为空则使用全量工具集） */
  availableTools?: string[];

  /** 对话历史（由 HistoryBuilder 构建，传递给 contextBuilder） */
  conversationHistory?: AiMessage[];
}
