import { z } from 'zod';

/** 图片题注与来源的共享合同；解析器、Editor 和后台不能各自猜测图片语义。 */
export const MarkdownImageCaptionSchema = z
  .string()
  .max(200)
  .refine(value => !/[\r\n]/u.test(value), '图片题注必须是单行纯文本');

export const MarkdownImageAttrsSchema = z
  .object({
    id: z.string().min(1),
    blockType: z.literal('image').default('image'),
    src: z.string().min(1),
    alt: z.string().default(''),
    title: z.string().default(''),
    caption: MarkdownImageCaptionSchema.default(''),
    assetId: z.string().min(1).nullable().default(null),
    width: z.number().positive().nullable().default(null),
    height: z.number().positive().nullable().default(null),
    alignment: z.enum(['left', 'center', 'right']).default('center'),
    uploadedAt: z.number().nullable().default(null),
  })
  .strict();
export type MarkdownImageAttrs = z.infer<typeof MarkdownImageAttrsSchema>;

export class MarkdownImageInvalidError extends Error {
  readonly code = 'MARKDOWN_IMAGE_INVALID';
  constructor(message: string) {
    super(`[MARKDOWN_IMAGE_INVALID] ${message}`);
  }
}

export function markdownImageReference(id: string): string {
  return `linnya-image://${encodeURIComponent(id)}`;
}

export function readMarkdownImageReference(src: string): string | null {
  if (!src.startsWith('linnya-image://')) return null;
  try {
    const id = decodeURIComponent(src.slice('linnya-image://'.length));
    return id && markdownImageReference(id) === src ? id : null;
  } catch {
    return null;
  }
}

export interface MarkdownImageEvent {
  readonly block_type: string;
  readonly attrs?: unknown;
  readonly structured_content?: unknown;
}

function containsImageFragment(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsImageFragment);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, item]) => (key === 'type' && item === 'image') || containsImageFragment(item)
  );
}

const imageInput = z
  .object({
    src: z.string().min(1),
    caption: MarkdownImageCaptionSchema,
    title: z.string().default(''),
  })
  .strict();

/** 图片只允许独立块；拒绝混排，不能在文字转换中静默丢图。 */
export function admitMarkdownImageEvent(
  event: MarkdownImageEvent
): z.infer<typeof imageInput> | null {
  if (event.block_type !== 'ImageBlock') {
    if (containsImageFragment(event.structured_content) || containsImageFragment(event.attrs)) {
      throw new MarkdownImageInvalidError(
        '图片必须独占一个段落，不能放在标题、列表、表格或正文行内。'
      );
    }
    return null;
  }
  const parsed = imageInput.safeParse(event.attrs);
  if (!parsed.success) throw new MarkdownImageInvalidError(parsed.error.message);
  const { src } = parsed.data;
  if (!readMarkdownImageReference(src) && !src.startsWith('conversation:/')) {
    throw new MarkdownImageInvalidError(
      '图片来源必须是当前文档的 linnya-image 引用或当前会话的 conversation:/ 文件。'
    );
  }
  return parsed.data;
}

export function readPendingMarkdownImage(metadata: unknown): MarkdownImageAttrs | null {
  if (!metadata || typeof metadata !== 'object' || !('image' in metadata) || metadata.image == null)
    return null;
  return MarkdownImageAttrsSchema.parse(metadata.image);
}

/** Pending 自持完整来源。引用与快照必须相符，不能借接受修订注入另一个来源。 */
export function hydrateMarkdownImage(
  input: { readonly src: string; readonly caption: string },
  snapshot: MarkdownImageAttrs | null
): MarkdownImageAttrs {
  if (!snapshot || readMarkdownImageReference(input.src) !== snapshot.id) {
    throw new MarkdownImageInvalidError('图片引用不属于当前文档，或缺少已接纳的图片来源快照。');
  }
  if (/^(?:linnya-image:|conversation:)/u.test(snapshot.src)) {
    throw new MarkdownImageInvalidError('图片来源尚未物化为文档资产。');
  }
  return MarkdownImageAttrsSchema.parse({ ...snapshot, caption: input.caption });
}

/** 标签内的方括号、反斜杠与强调需要转义；目标始终为不泄露本机位置的引用。 */
export function serializeMarkdownImage(attrs: Record<string, unknown>): string {
  const caption = MarkdownImageCaptionSchema.parse(attrs.caption ?? '');
  const src = typeof attrs.src === 'string' ? attrs.src : '';
  const target =
    src.startsWith('conversation:/') || readMarkdownImageReference(src)
      ? src
      : markdownImageReference(String(attrs.id));
  const label = caption.replace(/[\\\[\]*_`!<>&]/gu, character =>
    character === '&'
      ? '&amp;'
      : character === '<'
        ? '&lt;'
        : character === '>'
          ? '&gt;'
          : `\\${character}`
  );
  return `![${label}](<${target.replace(/ /gu, '%20')}>)`;
}
