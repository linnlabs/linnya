/**
 * Conversation 工具卡只实现公开插件合同，不在域内复制第二份结构定义。
 * 新增合同字段时必须先修改 plugin-host-contract，再由 host 与插件共同消费。
 */
import type {
  ToolUiAliasConfig,
  ToolUiImageAttachmentRef,
  ToolUiEntry,
} from '@linnya/plugin-host-contract/renderer/toolUi';

export type {
  ToolCardPresentation,
  ToolCompactStepPresentation,
  ToolCompactStepProjector,
  ToolCompactStepProjectorInput,
  ToolLocalizedTextDescriptor,
  ToolPresentationProjection,
  ToolPresentationProjector,
  ToolPresentationProjectorInput,
  ToolTitleConfig,
  ToolTitleDescriptor,
  ToolUiAliasConfig,
  ToolUiImageAttachmentRef,
  ToolUiConfig,
  ToolUiEntry,
} from '@linnya/plugin-host-contract/renderer/toolUi';

/** Registry 在运行时区分普通卡片与 alias；结构合同仍由 plugin-host-contract 唯一定义。 */
export function isAliasConfig(entry: ToolUiEntry): entry is ToolUiAliasConfig {
  return 'resolveUiKey' in entry && typeof entry.resolveUiKey === 'function';
}
