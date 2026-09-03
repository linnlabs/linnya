/**
 * @file src/agent/context-manager/profiles/agent/contracts.ts
 */

import type { AiMessage, RuntimeResourceRef } from '../../../contracts';
import type { FenceInjection } from '../../shared/fences';

/**
 * Minimal request contract used by package-neutral agent profile code.
 * Product-specific invoke requests can extend this shape.
 */
export interface AgentProfileRequest {
  query: string;
  /** 当前轮 user_input 的不可变事件身份；存在时禁止再用 query 猜测消息。 */
  currentUserEventId?: string;
  /** 当前轮尚未进入 history 时，构造 user_input 所需的 durable 资源引用。 */
  currentUserAttachments?: RuntimeResourceRef[];
  promptKey: string;
  model_id?: string;
  modelId?: string;
  availableTools?: string[];
  conversationHistory?: AiMessage[];
  fences?: FenceInjection[];
}
