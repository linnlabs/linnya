import { canvasText } from '../../localization';

/** Host 预览对用户可展示的失败使用的错误名；其消息已按当前语言生成，不含内部细节。 */
const DISPLAYABLE_PREVIEW_FAILURE = 'DocumentPreviewUserError';

/**
 * 挂载失败给用户看的提示。只有 Host 声明可展示的消息原样显示；
 * 其余（IPC、插件加载、读取等）的原文属于内部细节，界面只给通用提示。
 */
export function canvasDocumentDetailNotice(failure: unknown): string {
  return failure instanceof Error && failure.name === DISPLAYABLE_PREVIEW_FAILURE && failure.message
    ? failure.message
    : canvasText('canvas.detail.mountFailed');
}
