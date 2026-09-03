import { DocumentBlockIdSchema } from '@app/schemas';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 校验可持久化 Markdown 文档的顶层块身份。
 *
 * block ID 必须在文档实体创建时完成 admission。持久化层只接受已经具备稳定、
 * 唯一身份的 rootBlock，禁止在读取、打开或后续编辑时补造 ID。
 */
export function assertMarkdownDocumentBlockIdentities(document: unknown): void {
  if (!isRecord(document) || !Array.isArray(document.content)) {
    throw new Error('Markdown document must contain a top-level content array');
  }

  const admittedIds = new Set<string>();
  let rootBlockIndex = 0;
  for (const candidate of document.content) {
    if (!isRecord(candidate) || candidate.type !== 'rootBlock') continue;

    rootBlockIndex += 1;
    const attrs = isRecord(candidate.attrs) ? candidate.attrs : undefined;
    const parsedId = DocumentBlockIdSchema.safeParse(attrs?.id);
    if (!parsedId.success) {
      throw new Error(
        `Markdown root block ${rootBlockIndex} is missing its admitted block identity`,
      );
    }
    if (admittedIds.has(parsedId.data)) {
      throw new Error(
        `Markdown root block ${rootBlockIndex} repeats block identity ${parsedId.data}`,
      );
    }
    admittedIds.add(parsedId.data);
  }
}
