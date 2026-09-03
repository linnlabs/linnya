import { IMAGE_GENERATION_TOOL_ERROR_CODES } from '@app/schemas';
import type { ToolErrorAction } from '../definitions/toolErrorAction';

/**
 * 稳定业务错误码到用户可执行修复动作的唯一投影。
 *
 * 不读取后端自然语言，也不按工具名猜测；没有明确产品动作的错误继续使用通用错误卡。
 */
export function projectToolErrorAction(errorCode: string | undefined): ToolErrorAction | undefined {
  if (errorCode !== IMAGE_GENERATION_TOOL_ERROR_CODES.modelNotConfigured) return undefined;
  return {
    messageKey: 'conversation.tool.error.imageModelNotConfigured',
    actionLabelKey: 'conversation.tool.error.configureImageModel',
    settingsTabId: 'model',
  };
}
