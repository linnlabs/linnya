import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DatabaseService } from 'src/electron-main/services/database';
import { QdrantAdapter } from 'src/infra/adapters/vector-store/qdrant/QdrantAdapter';
import { pathManager } from 'src/shared/utils/pathManager';
import { BetterSqliteMetadataRepository } from 'src/features/knowledge-base/infrastructure/sqlite/better-sqlite-metadata.repository';
import { QdrantRepositoryImpl } from '../../../infrastructure/QdrantRepositoryImpl';
import { FileSotRepository } from '../../../infrastructure/sotRepository';
import { FileOriginalDocumentRepository } from '../../../infrastructure/fileOriginalDocumentRepository';
import { createDocument } from '../../../domain/document';
import { BlockType, createDocumentSoT } from '../../../domain/block';
import { createKnowledgeBase } from '../../../domain/knowledgeBase';
import { getGraphNodesCollectionName } from '../../../graph/infrastructure/qdrantCollections';
import { KnowledgeBaseMgmtService } from '../KnowledgeBaseMgmtService';

describe('knowledge deletion with vector service failures', () => {
  it.each(['chunks', 'graph'] as const)(
    'preserves source and live storage when %s deletion returns HTTP 500',
    async failureStage => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'linnya-kb-delete-'));
      const kbId = 'retained-library';
      const failedCollection = failureStage === 'chunks' ? kbId : getGraphNodesCollectionName(kbId);
      const collectionDirectory = path.join(
        root,
        'qdrant',
        'storage',
        'collections',
        failedCollection
      );
      const sentinelPath = path.join(collectionDirectory, 'active-segment');
      await mkdir(collectionDirectory, { recursive: true });
      await writeFile(sentinelPath, 'owned by running qdrant');
      // 旧实现的物理删除必须也指向隔离夹具，绝不触碰开发实例的集合。
      const storagePath = vi.spyOn(pathManager, 'getKbDataPath').mockReturnValue(root);
      const deleted: string[] = [];
      const server = createServer((request, response) => {
        const collection = new URL(request.url ?? '/', 'http://localhost').pathname.split('/')[2];
        response.setHeader('content-type', 'application/json');
        if (request.method === 'DELETE' && collection === failedCollection) {
          response
            .writeHead(500)
            .end(
              JSON.stringify({
                status: { error: 'Service internal error: operation timed out' },
                time: 0,
              })
            );
        } else {
          if (request.method === 'DELETE') deleted.push(collection);
          response.end(
            JSON.stringify({
              result: request.method === 'DELETE' ? true : {},
              status: 'ok',
              time: 0,
            })
          );
        }
      });
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('HTTP fixture did not bind a TCP port');
      const database = new DatabaseService(path.join(root, 'workspace.sqlite'));
      database.initialize();
      const metadataRepository = new BetterSqliteMetadataRepository(database.getDb());
      const sotRepository = new FileSotRepository(path.join(root, 'sot'));
      const originalDocumentRepository = new FileOriginalDocumentRepository(
        path.join(root, 'originals')
      );
      const adapter = new QdrantAdapter({ url: `http://127.0.0.1:${address.port}` });
      const service = new KnowledgeBaseMgmtService({
        metadataRepository,
        sotRepository,
        originalDocumentRepository,
        qdrantRepository: new QdrantRepositoryImpl(async () => adapter),
      });
      try {
        await metadataRepository.createKnowledgeBase(createKnowledgeBase(kbId, '不可丢失的资料'));
        const document = createDocument('retained-document', kbId, 'original.pdf', 20);
        await metadataRepository.addDocument(document);
        const source = createDocumentSoT(document, [
          { block_type: BlockType.PARAGRAPH, text: '原文内容必须保留。' },
        ]);
        await sotRepository.save(document.id, source);
        const originalPath = path.join(root, 'upload.pdf');
        await writeFile(originalPath, '%PDF-1.7\noriginal bytes');
        const original = await originalDocumentRepository.save({
          kbId,
          docId: document.id,
          sourcePath: originalPath,
          originalFilename: document.filename,
        });

        await expect(service.deleteKnowledgeBase(kbId)).rejects.toThrow();
        expect(await readFile(sentinelPath, 'utf8')).toBe('owned by running qdrant');
        expect(await sotRepository.get(document.id)).toEqual(source);
        expect(await readFile(original.path, 'utf8')).toBe('%PDF-1.7\noriginal bytes');
        expect((await metadataRepository.getDocumentById(document.id))?.kbId).toBe(kbId);
        expect(await metadataRepository.getKnowledgeBaseById(kbId)).toBeDefined();
        // 图谱删除失败前 chunk 集合可能已删除；保留原文供显式重建，不伪称跨集合回滚。
        expect(deleted).toEqual(failureStage === 'graph' ? [kbId] : []);
      } finally {
        database.close();
        await new Promise<void>((resolve, reject) =>
          server.close(error => (error ? reject(error) : resolve()))
        );
        storagePath.mockRestore();
        await rm(root, { recursive: true, force: true });
      }
    }
  );
});
