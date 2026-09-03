export type SubrunTraceDisplayStatus = 'loading' | 'success' | 'error';

/**
 * 过程面板的披露方式由产品 surface 决定，不能用初始展开状态间接推断。
 * Deep Search 需要用户控制过程密度；普通 subrun 已有独立详情页，父卡只展示常驻摘要。
 */
export type SubrunTraceDisclosureMode = 'collapsible' | 'static-expanded';

export interface SubrunTraceDisplayStep {
  /**
   * 步骤的稳定展示身份，直接来自 Runtime 工具事实。
   * 同名工具可以在同一 subrun 内多次调用，组件不得退回工具名或数组下标作为 key。
   */
  readonly toolCallId: string;
  readonly toolName: string;
  /** Renderer registry 已接纳的延迟本地化标题。 */
  readonly title: ToolLocalizedTextDescriptor;
  readonly status: SubrunTraceDisplayStatus;
  readonly durationMs?: number;
}
import type { ToolLocalizedTextDescriptor } from '@linnya/plugin-host-contract/renderer/toolUi';
