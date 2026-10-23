import {
  MarkdownImageAttrsSchema,
  hydrateMarkdownImage,
  markdownImageReference,
  readMarkdownImageReference,
  type MarkdownImageAttrs,
} from '@app/schemas';
import { generateEditorBlockId } from 'src/shared/utils/idUtils';
import { planMarkdownBlocks } from '../../normalization';
import { serializeMarkdownFileWriteTarget } from '../functions/serializeMarkdownFileWriteTarget';

export type ResolveMarkdownImageSource = (locator: string) => Promise<{
  readonly src: string;
  readonly assetId: string;
  readonly width: number;
  readonly height: number;
}>;

/** 编译整批后才调用 Host；新图来源被替换为文档内引用，Pending 不保存会话路径。 */
export async function prepareMarkdownImageInput(params: {
  readonly markdown: string;
  readonly existing: ReadonlyMap<string, MarkdownImageAttrs>;
  readonly resolve: ResolveMarkdownImageSource;
}) {
  const imageSources = new Map<string, MarkdownImageAttrs>();
  // 普通文字写入不额外编译或规范化，保持 citation 等后续准入看到的原始输入。
  if (!params.markdown.includes('![')) return { markdown: params.markdown, imageSources };
  const planned = await planMarkdownBlocks(params.markdown);
  const document = planned.docJson;
  if (!document) return { markdown: params.markdown, imageSources };
  const images = document.content.flatMap(root => {
    const node = root.content?.[0];
    return node?.type === 'imageBlock' ? [node] : [];
  });
  if (images.length === 0) return { markdown: params.markdown, imageSources };
  // 先验证已有文档引用；未知引用不能触发任何本地图片接管。
  for (const image of images) {
    const input = MarkdownImageAttrsSchema.parse(image.attrs);
    const id = readMarkdownImageReference(input.src);
    if (id) hydrateMarkdownImage(input, params.existing.get(id) ?? null);
  }
  for (const image of images) {
    const input = MarkdownImageAttrsSchema.parse(image.attrs);
    if (readMarkdownImageReference(input.src)) continue;
    const source = await params.resolve(input.src);
    const id = generateEditorBlockId();
    const attrs = MarkdownImageAttrsSchema.parse({
      ...input,
      ...source,
      id,
      alt: input.caption,
      uploadedAt: Date.now(),
    });
    imageSources.set(id, attrs);
    image.attrs = { ...attrs, src: markdownImageReference(id) };
  }
  return {
    markdown: serializeMarkdownFileWriteTarget({
      document,
      annotationComments: planned.annotationComments,
      projectBody: markdown => markdown,
    }),
    imageSources,
  };
}
