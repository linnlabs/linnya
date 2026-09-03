/**
 * @file src/features/knowledge-base/infrastructure/originalDocumentRepository.ts
 *
 * 知识库原始文件仓储。
 *
 * 说明：
 * - SoT 保存的是结构化内容 JSON，不是上传原文件；
 * - PDF partial 续跑失败页必须重新读取原始 PDF，因此需要一个独立且窄小的原始文件仓储。
 */

export interface OriginalDocumentSaveInput {
  kbId: string;
  docId: string;
  sourcePath: string;
  originalFilename: string;
}

export interface OriginalDocumentRecord {
  kbId: string;
  docId: string;
  path: string;
  sizeBytes: number;
}

export interface OriginalDocumentRepository {
  save(input: OriginalDocumentSaveInput): Promise<OriginalDocumentRecord>;
  getPath(kbId: string, docId: string): Promise<string | undefined>;
  getSizeBytes(kbId: string, docId: string): Promise<number | undefined>;
  delete(kbId: string, docId: string): Promise<boolean>;
  deleteByKnowledgeBase(kbId: string): Promise<number>;
}
