import * as contextManager from 'linnkit/context-manager';
import { toolRegistry } from './toolRegistry';

/**
 * Linnya 默认 ToolManager 装配。
 *
 * 中文备注：
 * - `ToolManager` 本身只消费 registry port；
 * - 宿主默认把 `toolRegistry` 绑定到这里，避免上层 builder 直接知道单例细节；
 * - 后续若宿主切换动态 registry，只需要替换这里。
 */
export function createDefaultToolManager(): contextManager.agentTools.ToolManager {
  return new contextManager.agentTools.ToolManager(toolRegistry);
}
