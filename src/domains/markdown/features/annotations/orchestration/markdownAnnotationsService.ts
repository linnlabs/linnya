import { getCurrentRootBlockIdSetFromDoc } from '../../block-content';
import type {
  CreateMarkdownAnnotationInput,
  MarkdownAnnotation,
  MarkdownAnnotationDocumentReader,
} from '../definitions/markdownAnnotation';
import { MarkdownAnnotationRepository } from '../infrastructure/sqlite/markdownAnnotationRepository';

/** 批注实体的业务入口：在写入前校验其目标块属于当前 Markdown 文档。 */
export class MarkdownAnnotationsService {
  constructor(
    private readonly repository: MarkdownAnnotationRepository,
    private readonly documentReader: MarkdownAnnotationDocumentReader
  ) {}

  listForDocument(documentNodeId: string): MarkdownAnnotation[] {
    return this.repository.listForDocument(documentNodeId);
  }

  create(input: CreateMarkdownAnnotationInput): MarkdownAnnotation {
    const blockIds = getCurrentRootBlockIdSetFromDoc(
      this.documentReader.getDocument(input.documentNodeId)
    );
    if (!blockIds.has(input.targetBlockId)) {
      throw new Error(
        `[MarkdownAnnotationsService] 目标块不存在，禁止创建批注: `
          + `documentId=${input.documentNodeId}, blockId=${input.targetBlockId}`
      );
    }

    const now = Date.now();
    return this.repository.insert({
      id: input.id,
      documentNodeId: input.documentNodeId,
      targetBlockId: input.targetBlockId,
      contentJson: input.contentJson,
      createdAt: input.createdAt ? new Date(input.createdAt).getTime() : now,
      updatedAt: now,
    });
  }

  update(id: string, updates: Readonly<Record<string, unknown>>): void {
    this.repository.updateContent(id, updates, Date.now());
  }

  delete(id: string): void {
    this.repository.softDelete(id, Date.now());
  }
}
