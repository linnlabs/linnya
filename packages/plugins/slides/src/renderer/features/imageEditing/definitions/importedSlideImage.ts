import type { SlidesImportedImage } from '@plugin/slides/shared/authoringEditing';

/** 仅存活于待保存预览；不会进入 IPC 命令、源码或正式文稿状态。 */
export interface ImportedSlideImage extends SlidesImportedImage {
  readonly previewSource: string;
}
