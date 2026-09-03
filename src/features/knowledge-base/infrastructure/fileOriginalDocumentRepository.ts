/**
 * @file src/features/knowledge-base/infrastructure/fileOriginalDocumentRepository.ts
 *
 * 文件系统版原始 PDF 仓储。
 */

import fs from 'fs/promises';
import path from 'path';
import { logger } from '@shared/index';
import {
  type OriginalDocumentRecord,
  type OriginalDocumentRepository,
  type OriginalDocumentSaveInput,
} from './originalDocumentRepository';

const PDF_EXTENSION = '.pdf';

export class FileOriginalDocumentRepository implements OriginalDocumentRepository {
  constructor(private readonly basePath: string) {
    void this.ensureBaseDirectory();
  }

  async save(input: OriginalDocumentSaveInput): Promise<OriginalDocumentRecord> {
    this.validateId('kbId', input.kbId);
    this.validateId('docId', input.docId);

    const extension = path.extname(input.originalFilename).toLowerCase();
    if (extension !== PDF_EXTENSION) {
      throw new Error(`原始文件仓储仅支持 PDF: ${input.originalFilename}`);
    }

    await this.ensureDocumentDirectory(input.kbId);
    const targetPath = this.getDocumentPath(input.kbId, input.docId);
    await fs.copyFile(input.sourcePath, targetPath);

    const stat = await fs.stat(targetPath);
    if (stat.size <= 0) {
      throw new Error(`原始 PDF 保存失败，目标文件为空: ${targetPath}`);
    }

    return {
      kbId: input.kbId,
      docId: input.docId,
      path: targetPath,
      sizeBytes: stat.size,
    };
  }

  async getPath(kbId: string, docId: string): Promise<string | undefined> {
    const targetPath = this.getDocumentPath(kbId, docId);
    try {
      await fs.access(targetPath);
      return targetPath;
    } catch {
      return undefined;
    }
  }

  async getSizeBytes(kbId: string, docId: string): Promise<number | undefined> {
    const targetPath = await this.getPath(kbId, docId);
    if (!targetPath) return undefined;
    const stat = await fs.stat(targetPath);
    return stat.size;
  }

  async delete(kbId: string, docId: string): Promise<boolean> {
    const targetPath = this.getDocumentPath(kbId, docId);
    try {
      await fs.unlink(targetPath);
      return true;
    } catch (error) {
      if (this.isNotFoundError(error)) return false;
      logger.error(`删除原始 PDF 失败: kbId=${kbId}, docId=${docId}, error=${String(error)}`);
      throw error;
    }
  }

  async deleteByKnowledgeBase(kbId: string): Promise<number> {
    this.validateId('kbId', kbId);
    const dir = this.getKnowledgeBaseDirectory(kbId);
    try {
      const entries = await fs.readdir(dir);
      await fs.rm(dir, { recursive: true, force: true });
      return entries.filter((entry) => entry.endsWith(PDF_EXTENSION)).length;
    } catch (error) {
      if (this.isNotFoundError(error)) return 0;
      logger.error(`删除知识库原始 PDF 目录失败: kbId=${kbId}, error=${String(error)}`);
      throw error;
    }
  }

  private async ensureBaseDirectory(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true });
  }

  private async ensureDocumentDirectory(kbId: string): Promise<void> {
    await fs.mkdir(this.getKnowledgeBaseDirectory(kbId), { recursive: true });
  }

  private getDocumentPath(kbId: string, docId: string): string {
    this.validateId('kbId', kbId);
    this.validateId('docId', docId);
    return path.join(this.getKnowledgeBaseDirectory(kbId), `${docId}${PDF_EXTENSION}`);
  }

  private getKnowledgeBaseDirectory(kbId: string): string {
    this.validateId('kbId', kbId);
    return path.join(this.basePath, kbId);
  }

  private validateId(label: string, value: string): void {
    if (!/^[a-zA-Z0-9_.-]+$/.test(value)) {
      throw new Error(`${label} 包含非法路径字符: ${value}`);
    }
  }

  private isNotFoundError(error: unknown): boolean {
    return (
      error instanceof Error &&
      'code' in error &&
      typeof error.code === 'string' &&
      error.code === 'ENOENT'
    );
  }
}
