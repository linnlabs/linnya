const IMAGE_FILE_NAME_PATTERN = /\.(?:jpe?g|png|webp)$/i;

export type ConversationImageEntrySource = 'picker' | 'paste' | 'drop';

export interface ConversationImageEntrySelection {
  readonly files: readonly File[];
  readonly shouldConsumeEvent: boolean;
}

/**
 * 浏览器入口只负责识别“用户想添加图片”；文件是否真是受支持图片仍由 host 解码确认。
 * 空 MIME 常见于部分桌面拖拽，因此仅在 MIME 缺失时用文件名帮助识别入口意图。
 */
function hasImageIntent(file: File): boolean {
  return (
    file.type.startsWith('image/')
    || (file.type.length === 0 && IMAGE_FILE_NAME_PATTERN.test(file.name))
  );
}

/**
 * 三类 UI 入口共用这一条文件选择规则，再统一进入 host staging：
 * - paste 只提取图片意图，保留普通文本给编辑器处理；
 * - picker/drop 不在 Renderer 猜格式，非图片或伪 MIME 也交给 host 逐项解码拒绝。
 */
export function selectConversationImageFiles(input: {
  readonly source: ConversationImageEntrySource;
  readonly files: readonly File[];
  readonly hasPlainText?: boolean;
}): ConversationImageEntrySelection {
  const selectedFiles = input.source === 'paste'
    ? input.files.filter(hasImageIntent)
    : [...input.files];

  return {
    files: selectedFiles,
    shouldConsumeEvent: selectedFiles.length > 0
      && (input.source !== 'paste' || input.hasPlainText !== true),
  };
}
