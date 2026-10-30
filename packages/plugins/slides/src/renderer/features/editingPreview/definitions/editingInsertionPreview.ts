import type { SlidesInsertedObject } from '@plugin/slides/shared/authoringEditing';

/** 已接纳、未呈现的新增对象；不提供命中或已保存身份。 */
export interface EditingInsertionPreview {
  readonly object: SlidesInsertedObject;
  readonly imageSource?: string;
}
