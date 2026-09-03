import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EmbeddingPort, TextGenerationPort } from 'src/domains/model-inference';
import type { DocumentOcrPort } from 'src/domains/document-ocr';
import { ServiceRegistry } from 'src/core/di/ServiceRegistry';
import { BlockType, type DocumentSoT } from '../../domain/block';
import {
  DocumentStatus,
  type Document,
  type DocumentParseDiagnostics,
} from '../../domain/document';
import type { KnowledgeBase } from '../../domain/knowledgeBase';
import type { MetadataRepository } from '../../infrastructure/metadataRepository';
import type { OriginalDocumentRepository } from '../../infrastructure/originalDocumentRepository';
import type {
  QdrantPoint,
  QdrantRepository,
  RetrievedPoint,
  SearchResult,
} from '../../infrastructure/qdrantRepository';
import type { SotRepository } from '../../infrastructure/sotRepository';
import { continueFailedPdfPages } from './continueFailedPdfPages';

const mocks = vi.hoisted(() => ({
  getPdfPageCountCrossPlatform: vi.fn(),
  processPdfPagesWithVisionDiagnostics: vi.fn(),
}));

vi.mock('src/features/parsers/pdfParser/adapters/PdfParseAdapter', () => ({
  getPdfPageCountCrossPlatform: mocks.getPdfPageCountCrossPlatform,
}));

vi.mock('src/features/parsers/pdfParser/strategies/VisionRecognitionStrategy', () => ({
  processPdfPagesWithVisionDiagnostics: mocks.processPdfPagesWithVisionDiagnostics,
}));

const KB_ID = 'kb-1';
const DOC_ID = 'doc-1';

type GraphEnqueueFn = (kbId: string, docId: string) => Promise<void>;

describe('continueFailedPdfPages', () => {
  let tempDir: string;
  let originalPdfPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-continue-pdf-'));
    originalPdfPath = path.join(tempDir, 'source.pdf');
    await fs.writeFile(originalPdfPath, Buffer.from('%PDF-1.7\ncontent'));
    mocks.getPdfPageCountCrossPlatform.mockReset();
    mocks.processPdfPagesWithVisionDiagnostics.mockReset();
    mocks.getPdfPageCountCrossPlatform.mockResolvedValue(3);
    ServiceRegistry.getInstance().reset();
  });

  afterEach(async () => {
    ServiceRegistry.getInstance().reset();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('恢复失败页时只增量合并 SoT/Qdrant，并更新诊断', async () => {
    const metadata = createMetadataRepository(createPartialDocument());
    const sot = createSotRepository(createExistingSot());
    const qdrant = createQdrantRepository();
    const original = createOriginalDocumentRepository(originalPdfPath);
    const graphEnqueue = vi.fn<GraphEnqueueFn>().mockResolvedValue(undefined);
    ServiceRegistry.getInstance().register(
      'knowledgeGraphQueueOrchestrator',
      () => ({ enqueueGraphExtractionForDocument: graphEnqueue }),
      true
    );

    mocks.processPdfPagesWithVisionDiagnostics.mockResolvedValueOnce({
      success: true,
      blocks: [
        {
          blockId: 'parser-block-page-2',
          text: '第 2 页恢复内容',
          type: 'paragraph',
          source_info: { page_number: 2 },
        },
      ],
      diagnostics: diagnosticsWithFailedPages([3], [1, 2]),
    });

    const result = await continueFailedPdfPages(
      {
        metadataRepository: metadata,
        sotRepository: sot,
        qdrantRepository: qdrant,
        originalDocumentRepository: original,
        ...createInferenceCapabilities(),
      },
      KB_ID,
      DOC_ID
    );

    expect(result).toMatchObject({
      docId: DOC_ID,
      attemptedPages: [2, 3],
      recoveredPages: [2],
      remainingFailedPages: [3],
      addedBlocks: 1,
    });

    const savedSot = await sot.get(DOC_ID);
    expect(savedSot?.structure.root).toHaveLength(2);
    expect(savedSot?.structure.root[0]).toBe('existing-block');
    const recoveredBlockId = savedSot?.structure.root[1];
    expect(recoveredBlockId).toBe(qdrant.addedPoints[0]?.id);
    expect(savedSot?.content_blocks[recoveredBlockId ?? '']?.source_info?.page_num).toBe(2);

    expect(qdrant.deletedPointIds).toEqual([]);
    expect(qdrant.deletedDocIds).toEqual([]);
    expect(qdrant.addedPoints).toHaveLength(1);
    expect(qdrant.addedPoints[0]?.payload.doc_id).toBe(DOC_ID);
    expect(qdrant.addedPoints[0]?.payload.page_number).toBe(2);
    expect(graphEnqueue).toHaveBeenCalledWith(KB_ID, DOC_ID);

    const updatedDocument = await metadata.getDocumentById(DOC_ID);
    expect(updatedDocument?.parseDiagnostics?.parsedPages).toEqual([1, 2]);
    expect(updatedDocument?.parseDiagnostics?.failedPages.map(page => page.pageNumber)).toEqual([
      3,
    ]);
    expect(updatedDocument?.parseDiagnostics?.isPartial).toBe(true);
  });

  it('新增点提交点校验失败时只回滚本次新增点，并恢复旧 SoT', async () => {
    const metadata = createMetadataRepository(createPartialDocument());
    const existingSot = createExistingSot();
    const sot = createSotRepository(existingSot);
    const qdrant = createQdrantRepository({ countWrittenPoints: 0 });
    const original = createOriginalDocumentRepository(originalPdfPath);

    mocks.processPdfPagesWithVisionDiagnostics.mockResolvedValueOnce({
      success: true,
      blocks: [
        {
          blockId: 'parser-block-page-2',
          text: '第 2 页恢复内容',
          type: 'paragraph',
          source_info: { page_number: 2 },
        },
      ],
      diagnostics: diagnosticsWithFailedPages([], [1, 2, 3]),
    });

    await expect(
      continueFailedPdfPages(
        {
          metadataRepository: metadata,
          sotRepository: sot,
          qdrantRepository: qdrant,
          originalDocumentRepository: original,
          ...createInferenceCapabilities(),
        },
        KB_ID,
        DOC_ID
      )
    ).rejects.toThrow('新增向量点校验失败');

    expect(await sot.get(DOC_ID)).toEqual(existingSot);
    expect(qdrant.deletedDocIds).toEqual([]);
    expect(qdrant.deletedPointIds).toEqual(qdrant.addedPoints.map(point => point.id));
    expect((await metadata.getDocumentById(DOC_ID))?.parseDiagnostics).toEqual(
      createPartialDiagnostics()
    );
  });

  it('诊断更新失败时回滚本次新增点和 SoT，避免重复续跑状态漂移', async () => {
    const metadata = createMetadataRepository(createPartialDocument(), {
      failDiagnosticsUpdate: true,
    });
    const existingSot = createExistingSot();
    const sot = createSotRepository(existingSot);
    const qdrant = createQdrantRepository();
    const original = createOriginalDocumentRepository(originalPdfPath);

    mocks.processPdfPagesWithVisionDiagnostics.mockResolvedValueOnce({
      success: true,
      blocks: [
        {
          blockId: 'parser-block-page-2',
          text: '第 2 页恢复内容',
          type: 'paragraph',
          source_info: { page_number: 2 },
        },
      ],
      diagnostics: diagnosticsWithFailedPages([], [1, 2, 3]),
    });

    await expect(
      continueFailedPdfPages(
        {
          metadataRepository: metadata,
          sotRepository: sot,
          qdrantRepository: qdrant,
          originalDocumentRepository: original,
          ...createInferenceCapabilities(),
        },
        KB_ID,
        DOC_ID
      )
    ).rejects.toThrow('更新 PDF 解析诊断失败');

    expect(await sot.get(DOC_ID)).toEqual(existingSot);
    expect(qdrant.deletedDocIds).toEqual([]);
    expect(qdrant.deletedPointIds).toEqual(qdrant.addedPoints.map(point => point.id));
    expect((await metadata.getDocumentById(DOC_ID))?.parseDiagnostics).toEqual(
      createPartialDiagnostics()
    );
  });

  it('本次新增点删除失败时仍恢复旧 SoT', async () => {
    const metadata = createMetadataRepository(createPartialDocument());
    const existingSot = createExistingSot();
    const sot = createSotRepository(existingSot);
    const qdrant = createQdrantRepository({ countWrittenPoints: 0, failDeletePointsByIds: true });
    const original = createOriginalDocumentRepository(originalPdfPath);

    mocks.processPdfPagesWithVisionDiagnostics.mockResolvedValueOnce({
      success: true,
      blocks: [
        {
          blockId: 'parser-block-page-2',
          text: '第 2 页恢复内容',
          type: 'paragraph',
          source_info: { page_number: 2 },
        },
      ],
      diagnostics: diagnosticsWithFailedPages([], [1, 2, 3]),
    });

    await expect(
      continueFailedPdfPages(
        {
          metadataRepository: metadata,
          sotRepository: sot,
          qdrantRepository: qdrant,
          originalDocumentRepository: original,
          ...createInferenceCapabilities(),
        },
        KB_ID,
        DOC_ID
      )
    ).rejects.toThrow('新增向量点校验失败');

    expect(qdrant.deletePointsByIdsAttempts).toBe(1);
    expect(await sot.get(DOC_ID)).toEqual(existingSot);
    expect((await metadata.getDocumentById(DOC_ID))?.parseDiagnostics).toEqual(
      createPartialDiagnostics()
    );
  });

  it('知识库未显式配置 PDF OCR 模型时，使用 capability 解析到的默认模型续跑', async () => {
    const metadata = createMetadataRepository(createPartialDocument(), {
      kbOverrides: {
        pdfOcrModelId: null,
        visionModelId: null,
      },
    });
    const sot = createSotRepository(createExistingSot());
    const qdrant = createQdrantRepository();
    const original = createOriginalDocumentRepository(originalPdfPath);

    mocks.processPdfPagesWithVisionDiagnostics.mockResolvedValueOnce({
      success: true,
      blocks: [],
      diagnostics: diagnosticsWithFailedPages([2, 3], [1]),
    });

    await continueFailedPdfPages(
      {
        metadataRepository: metadata,
        sotRepository: sot,
        qdrantRepository: qdrant,
        originalDocumentRepository: original,
        ...createInferenceCapabilities(),
        resolveModelByCapability: capability =>
          capability === 'pdf_ocr_default' ? 'capability-ocr-model' : undefined,
      },
      KB_ID,
      DOC_ID
    );

    expect(mocks.processPdfPagesWithVisionDiagnostics).toHaveBeenCalledWith(
      originalPdfPath,
      DOC_ID,
      [2, 3],
      3,
      expect.anything(),
      expect.anything(),
      'capability-ocr-model',
      expect.anything()
    );
  });

  it('缺少原始 PDF 时直接失败，不触碰 SoT/Qdrant/诊断', async () => {
    const metadata = createMetadataRepository(createPartialDocument());
    const sot = createSotRepository(createExistingSot());
    const qdrant = createQdrantRepository();
    const original = createOriginalDocumentRepository(undefined);

    await expect(
      continueFailedPdfPages(
        {
          metadataRepository: metadata,
          sotRepository: sot,
          qdrantRepository: qdrant,
          originalDocumentRepository: original,
          ...createInferenceCapabilities(),
        },
        KB_ID,
        DOC_ID
      )
    ).rejects.toThrow('缺少原始 PDF');

    expect(mocks.processPdfPagesWithVisionDiagnostics).not.toHaveBeenCalled();
    expect(qdrant.addedPoints).toEqual([]);
    expect(qdrant.deletedPointIds).toEqual([]);
    expect((await metadata.getDocumentById(DOC_ID))?.parseDiagnostics).toEqual(
      createPartialDiagnostics()
    );
  });
});

function createPartialDocument(): Document {
  return {
    id: DOC_ID,
    kbId: KB_ID,
    filename: 'source.pdf',
    fileSize: 12,
    status: DocumentStatus.COMPLETED,
    errorMessage: null,
    createdAt: 1,
    updatedAt: 1,
    taskId: null,
    parseDiagnostics: createPartialDiagnostics(),
  };
}

function createPartialDiagnostics(): DocumentParseDiagnostics {
  return diagnosticsWithFailedPages([2, 3], [1]);
}

function diagnosticsWithFailedPages(
  failedPages: number[],
  parsedPages: number[]
): DocumentParseDiagnostics {
  return {
    parser: 'pdf',
    pipeline: 'vision_page_image',
    totalPages: 3,
    parsedPages,
    failedPages: failedPages.map(pageNumber => ({
      pageNumber,
      errorKind: 'timeout',
      message: `page ${pageNumber} timeout`,
      retryable: true,
      shouldReduceConcurrency: true,
      shouldSplitSmaller: false,
    })),
    isPartial: failedPages.length > 0 && parsedPages.length > 0,
    createdAt: 1,
  };
}

function createExistingSot(): DocumentSoT {
  return {
    doc_id: DOC_ID,
    doc_title: 'source.pdf',
    metadata: {
      source_file: 'source.pdf',
      parser_version: 'postprocessor',
      file_size: 12,
      page_count: 3,
      vector_model: 'embedding-model',
      vision_model: 'vision-model',
    },
    content_blocks: {
      'existing-block': {
        block_type: BlockType.PARAGRAPH,
        text: '第 1 页内容\n',
        level: null,
        source_info: {
          page_num: 1,
          source_location: null,
        },
      },
    },
    structure: {
      root: ['existing-block'],
      toc: [],
    },
  };
}

function createMetadataRepository(
  document: Document,
  options: { failDiagnosticsUpdate?: boolean; kbOverrides?: Partial<KnowledgeBase> } = {}
): MetadataRepository {
  const documents = new Map<string, Document>([[document.id, document]]);
  let embeddingProvenance = 'embedding-model';
  const kb: KnowledgeBase = {
    id: KB_ID,
    name: 'KB',
    description: '',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    enableGraphIndexing: false,
    embeddingModelId: 'embedding-model',
    pdfOcrModelId: 'vision-model',
    ...options.kbOverrides,
  };

  return {
    createKnowledgeBase: async input => input,
    getAllKnowledgeBases: async () => [kb],
    getDocumentCountsByKnowledgeBaseIds: async () => ({}),
    getKnowledgeBaseById: async kbId => (kbId === KB_ID ? kb : undefined),
    getKnowledgeBaseEmbeddingProvenance: async kbId =>
      kbId === KB_ID ? embeddingProvenance : null,
    setKnowledgeBaseEmbeddingProvenance: async (kbId, embeddingModelId) => {
      if (kbId === KB_ID) embeddingProvenance = embeddingModelId;
    },
    deleteKnowledgeBase: async () => true,
    updateKnowledgeBase: async () => undefined,
    addDocument: async doc => {
      documents.set(doc.id, doc);
      return doc;
    },
    getDocumentById: async docId => documents.get(docId),
    getDocumentsInKnowledgeBase: async () => Array.from(documents.values()),
    getAllDocuments: async () => Array.from(documents.values()),
    updateDocumentStatus: async (docId, status, errorMessage) => {
      const current = documents.get(docId);
      if (!current) return false;
      documents.set(docId, { ...current, status, errorMessage: errorMessage ?? null });
      return true;
    },
    updateDocumentParseDiagnostics: async (docId, diagnostics) => {
      if (options.failDiagnosticsUpdate) return false;
      const current = documents.get(docId);
      if (!current) return false;
      documents.set(docId, { ...current, parseDiagnostics: diagnostics });
      return true;
    },
    deleteDocument: async docId => documents.delete(docId),
    close: () => undefined,
  };
}

function createSotRepository(initial: DocumentSoT): SotRepository {
  const sotByDocId = new Map<string, DocumentSoT>([[DOC_ID, structuredClone(initial)]]);
  return {
    save: async (docId, data) => {
      sotByDocId.set(docId, structuredClone(data));
    },
    get: async docId => {
      const data = sotByDocId.get(docId);
      return data ? structuredClone(data) : undefined;
    },
    delete: async docId => sotByDocId.delete(docId),
    listAllDocumentIds: async () => Array.from(sotByDocId.keys()),
  };
}

function createOriginalDocumentRepository(
  originalPath: string | undefined
): OriginalDocumentRepository {
  return {
    save: async () => {
      throw new Error('save 在续跑测试中不应被调用');
    },
    getPath: async () => originalPath,
    getSizeBytes: async () => undefined,
    delete: async () => false,
    deleteByKnowledgeBase: async () => 0,
  };
}

function createQdrantRepository(
  options: { countWrittenPoints?: number; failDeletePointsByIds?: boolean } = {}
): QdrantRepository & {
  addedPoints: QdrantPoint[];
  deletedPointIds: string[];
  deletedDocIds: string[];
  deletePointsByIdsAttempts: number;
} {
  const addedPoints: QdrantPoint[] = [];
  const deletedPointIds: string[] = [];
  const deletedDocIds: string[] = [];
  let deletePointsByIdsAttempts = 0;

  return {
    addedPoints,
    deletedPointIds,
    deletedDocIds,
    get deletePointsByIdsAttempts() {
      return deletePointsByIdsAttempts;
    },
    getOrCreateCollection: async () => undefined,
    deleteCollection: async () => undefined,
    addPoints: async (_collectionName, points) => {
      addedPoints.push(...points);
    },
    semanticSearch: async (): Promise<RetrievedPoint[]> => [],
    keywordSearch: async (): Promise<RetrievedPoint[]> => [],
    hybridSearch: async (): Promise<SearchResult> => ({
      semanticResults: [],
      keywordResults: [],
      combinedResults: [],
    }),
    deletePointsByDocId: async (_collectionName, docId) => {
      deletedDocIds.push(docId);
    },
    deletePointsByFilter: async () => undefined,
    deletePointsByIds: async (_collectionName, pointIds) => {
      deletePointsByIdsAttempts += 1;
      if (options.failDeletePointsByIds) {
        throw new Error('delete points failed');
      }
      deletedPointIds.push(...pointIds);
    },
    countPointsByDocId: async () => addedPoints.length,
    countPointsByIds: async () => options.countWrittenPoints ?? addedPoints.length,
    getCollectionInfo: async () => ({
      vectors_count: 0,
      indexed_vectors_count: 0,
      points_count: addedPoints.length,
      segments_count: 0,
      config: {},
    }),
    getAllPoints: async () => addedPoints.map(point => ({ id: point.id, payload: point.payload })),
    scrollPointsPage: async () => ({
      points: addedPoints.map(point => ({ id: point.id, payload: point.payload })),
      nextOffset: undefined,
    }),
    collectionExists: async () => true,
  };
}

function createEmbedding(): EmbeddingPort {
  return {
    embed: async request => ({ vectors: request.values.map(() => [0.1, 0.2, 0.3]) }),
  };
}

function createInferenceCapabilities(): {
  embedding: EmbeddingPort;
  textGeneration: TextGenerationPort;
  documentOcr: DocumentOcrPort;
} {
  return {
    embedding: createEmbedding(),
    textGeneration: {
      generate: async () => {
        throw new Error('textGeneration 在续跑编排测试中不应被调用');
      },
    },
    documentOcr: {
      resolveModelProfile: async () => undefined,
      recognizeDocument: async () => {
        throw new Error('documentOcr 在续跑编排测试中不应被调用');
      },
    },
  };
}
