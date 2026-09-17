import type { SlidesEditableTextContent, SlidesManualEditOperation } from '@plugin/slides/shared/authoringEditing';

/** 整框格式必须先读取已验证修订的作者正文；不从源码 AST 执行表达式或从渲染行反推 runs。 */
export type SlidesManualEditSourceOperation =
  | Exclude<SlidesManualEditOperation, { readonly op: 'set_text_style' }>
  | (Extract<SlidesManualEditOperation, { readonly op: 'set_text_style' }> & { readonly content: SlidesEditableTextContent });
