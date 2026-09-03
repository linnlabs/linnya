import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { DatabaseService } from '../../../../electron-main/services/database';
import { createDocument, type DocumentParseDiagnostics } from '../../domain/document';
import { createKnowledgeBase } from '../../domain/knowledgeBase';
import { BetterSqliteMetadataRepository } from './better-sqlite-metadata.repository';

describe('BetterSqliteMetadataRepository parse diagnostics', () => {
  let tempDir: string;
  let databaseService: DatabaseService;
  let repository: BetterSqliteMetadataRepository;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-kb-metadata-'));
    databaseService = new DatabaseService(path.join(tempDir, 'workspace.sqlite'));
    databaseService.initialize();
    repository = new BetterSqliteMetadataRepository(databaseService);
  });

  afterEach(() => {
    repository.close();
    databaseService.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('persists and reads PDF partial parse diagnostics', async () => {
    const document = createDocument('doc-diagnostics', 'default', 'partial.pdf', 1024);
    await repository.addDocument(document);

    const diagnostics: DocumentParseDiagnostics = {
      parser: 'pdf',
      pipeline: 'vision_page_image',
      totalPages: 3,
      parsedPages: [1, 3],
      failedPages: [
        {
          pageNumber: 2,
          errorKind: 'timeout',
          message: 'AI识别超时',
          retryable: true,
          shouldReduceConcurrency: true,
          shouldSplitSmaller: true,
        },
      ],
      isPartial: true,
      createdAt: 1_800_000_000_000,
    };

    await expect(repository.updateDocumentParseDiagnostics(document.id, diagnostics)).resolves.toBe(true);

    const loaded = await repository.getDocumentById(document.id);

    expect(loaded?.parseDiagnostics).toEqual(diagnostics);

    const raw = databaseService.getDb().prepare(`
      SELECT parse_diagnostics_json
      FROM kb_documents
      WHERE id = ?
    `).get(document.id) as { parse_diagnostics_json: string | null };

    expect(raw.parse_diagnostics_json).toBe(JSON.stringify(diagnostics));
  });
});

describe('BetterSqliteMetadataRepository knowledge base model overrides', () => {
  let tempDir: string;
  let databaseService: DatabaseService;
  let repository: BetterSqliteMetadataRepository;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-kb-model-overrides-'));
    databaseService = new DatabaseService(path.join(tempDir, 'workspace.sqlite'));
    databaseService.initialize();
    repository = new BetterSqliteMetadataRepository(databaseService);
  });

  afterEach(() => {
    repository.close();
    databaseService.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('does not treat legacy vision_model_id as a PDF OCR override', async () => {
    const db = databaseService.getDb();
    db.prepare(`
      UPDATE knowledge_bases
      SET pdf_ocr_model_id = NULL,
          image_vision_model_id = NULL,
          vision_model_id = ?
      WHERE id = 'default'
    `).run('PaddlePaddle/PaddleOCR-VL-1.5');

    const kb = await repository.getKnowledgeBaseById('default');

    expect(kb?.pdfOcrModelId).toBeNull();
    expect(kb?.visionModelId).toBe('PaddlePaddle/PaddleOCR-VL-1.5');
  });

  it('keeps explicit PDF OCR overrides from the new field', async () => {
    const db = databaseService.getDb();
    db.prepare(`
      UPDATE knowledge_bases
      SET pdf_ocr_model_id = ?,
          vision_model_id = ?
      WHERE id = 'default'
    `).run('custom-ocr-model', 'legacy-vision-model');

    const kb = await repository.getKnowledgeBaseById('default');

    expect(kb?.pdfOcrModelId).toBe('custom-ocr-model');
    expect(kb?.visionModelId).toBe('legacy-vision-model');
  });

  it('does not materialize model preferences when creating a knowledge base', async () => {
    const kb = {
      ...createKnowledgeBase('kb-legacy-vision', 'Legacy Vision KB'),
      embeddingModelId: 'embedding-preference',
      rerankModelId: 'rerank-preference',
      pdfOcrModelId: 'pdf-ocr-preference',
      imageVisionModelId: null,
      visionModelId: 'legacy-vision-model',
    };

    await repository.createKnowledgeBase(kb);

    const raw = databaseService.getDb().prepare(`
      SELECT embedding_model_id, rerank_model_id, pdf_ocr_model_id, image_vision_model_id, vision_model_id
      FROM knowledge_bases
      WHERE id = ?
    `).get(kb.id) as {
      embedding_model_id: string | null;
      rerank_model_id: string | null;
      pdf_ocr_model_id: string | null;
      image_vision_model_id: string | null;
      vision_model_id: string | null;
    };

    expect(raw.embedding_model_id).toBeNull();
    expect(raw.rerank_model_id).toBeNull();
    expect(raw.pdf_ocr_model_id).toBeNull();
    expect(raw.image_vision_model_id).toBeNull();
    expect(raw.vision_model_id).toBeNull();
  });
});
