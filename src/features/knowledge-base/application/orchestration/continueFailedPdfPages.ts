/**
 * @file src/features/knowledge-base/application/orchestration/continueFailedPdfPages.ts
 *
 * PDF partial 失败页续跑编排。
 *
 * 边界说明：
 * - 不复用全量摄入状态机的 StoringHandler，避免失败时触发 docId 级全量清理；
 * - 本编排只处理 diagnostics.failedPages 中仍失败的页，并以增量提交方式合并 SoT/Qdrant。
 */

import path from 'path';
import fs from 'fs/promises';
import { Logger } from 'src/shared/logger';
import type { EmbeddingPort, TextGenerationPort } from 'src/domains/model-inference';
import type { DocumentOcrPort } from 'src/domains/document-ocr';
import { ServiceRegistry } from 'src/core/di/ServiceRegistry';
import { DEFAULT_VECTOR_DIMENSION } from '@shared/constants';
import { DocumentSoTSchema, type Block, type DocumentSoT } from '../../domain/block';
import { DocumentStatus, type DocumentParseDiagnostics } from '../../domain/document';
import type { MetadataRepository } from '../../infrastructure/metadataRepository';
import type { OriginalDocumentRepository } from '../../infrastructure/originalDocumentRepository';
import type {
  QdrantPoint,
  QdrantRepository,
  VectorData,
} from '../../infrastructure/qdrantRepository';
import type { SotRepository } from '../../infrastructure/sotRepository';
import { resolveTargetSegmentCountByPointsCount } from '../../infrastructure/qdrant-repository/segmentPolicy';
import { postProcessBlocks, type RawBlock } from '../../ingestion/postprocessor';
import type { ParsedContentBlock, VectorizedBlock } from '../../ingestion/ingestionTypes';
import { textsToSparseVectors } from '../../ingestion/utils/textToSparseVector';
import { getPdfPageCountCrossPlatform } from 'src/features/parsers/pdfParser/adapters/PdfParseAdapter';
import { processPdfPagesWithVisionDiagnostics } from 'src/features/parsers/pdfParser/strategies/VisionRecognitionStrategy';
import type { ParsedBlock } from 'src/features/parsers/types';
import { resolveModelIdFromPolicy } from 'src/app-hosts/linnya/agent-registry/modelPolicyResolver';
import {
  PDF_OCR_DEFAULT_FALLBACK_MODEL_ID,
  PDF_OCR_MODEL_POLICY,
} from 'src/app-hosts/linnya/agent-registry/internals/ingestion/pdf_ocr';

const logger = new Logger('knowledge-base:continue-failed-pdf-pages');

export interface ContinueFailedPdfPagesDeps {
  metadataRepository: MetadataRepository;
  sotRepository: SotRepository;
  qdrantRepository: QdrantRepository;
  originalDocumentRepository: OriginalDocumentRepository;
  embedding: EmbeddingPort;
  textGeneration: TextGenerationPort;
  documentOcr: DocumentOcrPort;
  resolveModelByCapability?: (capability: string) => string | undefined;
}

export interface ContinueFailedPdfPagesResult {
  docId: string;
  attemptedPages: number[];
  recoveredPages: number[];
  remainingFailedPages: number[];
  addedBlocks: number;
}

export interface ContinueFailedPdfPagesOptions {
  pdfOcrModelId?: string | null;
  embeddingModelId?: string | null;
}

interface GraphExtractionEnqueuePort {
  enqueueGraphExtractionForDocument(kbId: string, docId: string): Promise<void>;
}

export async function continueFailedPdfPages(
  deps: ContinueFailedPdfPagesDeps,
  kbId: string,
  docId: string,
  options: ContinueFailedPdfPagesOptions = {}
): Promise<ContinueFailedPdfPagesResult> {
  const document = await deps.metadataRepository.getDocumentById(docId);
  if (!document || document.kbId !== kbId) {
    throw new Error(`未找到文档或文档不属于当前知识库: kbId=${kbId}, docId=${docId}`);
  }
  if (document.status !== DocumentStatus.COMPLETED) {
    throw new Error(
      `仅 completed 的 partial PDF 支持续跑失败页: docId=${docId}, status=${document.status}`
    );
  }
  if (path.extname(document.filename).toLowerCase() !== '.pdf') {
    throw new Error(`仅 PDF 文档支持续跑失败页: ${document.filename}`);
  }

  const diagnostics = document.parseDiagnostics;
  if (!diagnostics || diagnostics.parser !== 'pdf' || diagnostics.failedPages.length === 0) {
    return {
      docId,
      attemptedPages: [],
      recoveredPages: [],
      remainingFailedPages: [],
      addedBlocks: 0,
    };
  }

  const originalPath = await deps.originalDocumentRepository.getPath(kbId, docId);
  if (!originalPath) {
    throw new Error(`缺少原始 PDF，无法续跑失败页: docId=${docId}`);
  }

  const originalBytes = await fs.readFile(originalPath);
  const totalPages = await getPdfPageCountCrossPlatform(
    new Uint8Array(originalBytes.buffer, originalBytes.byteOffset, originalBytes.byteLength)
  );
  const attemptedPages = diagnostics.failedPages.map(page => page.pageNumber);
  const kb = await deps.metadataRepository.getKnowledgeBaseById(kbId);
  const requestedPdfOcrModelId =
    typeof options.pdfOcrModelId === 'string' && options.pdfOcrModelId.trim().length > 0
      ? options.pdfOcrModelId.trim()
      : undefined;
  const visionModelId =
    requestedPdfOcrModelId ??
    resolveModelIdFromPolicy(PDF_OCR_MODEL_POLICY, {
      kbPdfOcrModelId: kb?.pdfOcrModelId,
      kbVisionModelId: kb?.visionModelId,
      defaultVisionModelId: PDF_OCR_DEFAULT_FALLBACK_MODEL_ID,
      resolveByCapability: deps.resolveModelByCapability,
    }) ??
    PDF_OCR_DEFAULT_FALLBACK_MODEL_ID;

  const outcome = await processPdfPagesWithVisionDiagnostics(
    originalPath,
    docId,
    attemptedPages,
    totalPages,
    deps.textGeneration,
    deps.documentOcr,
    visionModelId,
    {
      targetPixels: 2048,
      maxRetries: 5,
      tpmLimitPerWorker: 20,
    }
  );

  const failedAgain = outcome.diagnostics?.failedPages ?? [];
  const parsedBlocks = outcome.success ? outcome.blocks : [];
  const recoveredPages = collectParsedPages(parsedBlocks);
  const nextDiagnostics = mergeDiagnosticsAfterRetry(diagnostics, {
    totalPages,
    recoveredPages,
    failedAgain,
  });

  if (parsedBlocks.length > 0) {
    const embeddingModelId = await resolveEmbeddingModelForIncrementalCommit({
      deps,
      kbId,
      requestedEmbeddingModelId: options.embeddingModelId,
    });
    await incrementallyCommitRecoveredPages({
      deps,
      kbId,
      docId,
      filename: document.filename,
      originalPath,
      embeddingModelId,
      visionModelId,
      parsedBlocks,
      nextDiagnostics,
    });
    await enqueueGraphExtractionAfterIncrementalUpdate(kbId, docId);
  } else {
    const updated = await deps.metadataRepository.updateDocumentParseDiagnostics(
      docId,
      nextDiagnostics
    );
    if (!updated) {
      throw new Error(`更新 PDF 解析诊断失败: docId=${docId}`);
    }
  }

  return {
    docId,
    attemptedPages,
    recoveredPages,
    remainingFailedPages: nextDiagnostics.failedPages.map(page => page.pageNumber),
    addedBlocks: parsedBlocks.length,
  };
}

async function resolveEmbeddingModelForIncrementalCommit(args: {
  deps: ContinueFailedPdfPagesDeps;
  kbId: string;
  requestedEmbeddingModelId?: string | null;
}): Promise<string> {
  const provenance = await args.deps.metadataRepository.getKnowledgeBaseEmbeddingProvenance(
    args.kbId
  );
  if (!provenance) {
    throw new Error(`知识库 ${args.kbId} 缺少 embedding 索引出身，无法安全续跑失败页`);
  }
  if (
    typeof args.requestedEmbeddingModelId === 'string' &&
    args.requestedEmbeddingModelId.trim().length > 0 &&
    args.requestedEmbeddingModelId.trim() !== provenance
  ) {
    throw new Error(
      `知识库 ${args.kbId} 的索引用 ${provenance} 构建，当前全局嵌入模型是 ${args.requestedEmbeddingModelId.trim()}。请清空并重新导入该知识库后再续跑失败页。`
    );
  }
  return provenance;
}

async function enqueueGraphExtractionAfterIncrementalUpdate(
  kbId: string,
  docId: string
): Promise<void> {
  try {
    const registry = ServiceRegistry.getInstance();
    const orchestrator = await registry.get<GraphExtractionEnqueuePort>(
      'knowledgeGraphQueueOrchestrator'
    );
    await orchestrator.enqueueGraphExtractionForDocument(kbId, docId);
  } catch (error) {
    logger.warn(
      `PDF 失败页续跑已完成，但图谱抽取入队失败；chunk 检索不受影响，图谱增强将等待后续回填: kbId=${kbId}, docId=${docId}`,
      error
    );
  }
}

function collectParsedPages(blocks: ParsedBlock[]): number[] {
  return Array.from(
    new Set(
      blocks
        .map(block => block.source_info?.page_number)
        .filter((pageNumber): pageNumber is number => typeof pageNumber === 'number')
    )
  ).sort((a, b) => a - b);
}

async function incrementallyCommitRecoveredPages(args: {
  deps: ContinueFailedPdfPagesDeps;
  kbId: string;
  docId: string;
  filename: string;
  originalPath: string;
  embeddingModelId: string;
  visionModelId: string;
  parsedBlocks: ParsedBlock[];
  nextDiagnostics: DocumentParseDiagnostics;
}): Promise<void> {
  const rawBlocks = toRawBlocks(args.parsedBlocks);
  const postProcessResult = await postProcessBlocks({
    rawBlocks,
    sourceFilePath: args.originalPath,
    docId: args.docId,
    originalFilename: args.filename,
  });
  const vectorizedBlocks = await vectorizeBlocks(
    args.deps.embedding,
    postProcessResult.processedBlocks,
    args.embeddingModelId
  );
  if (vectorizedBlocks.length === 0) {
    throw new Error(`失败页续跑未产生可提交块: docId=${args.docId}`);
  }

  const existingSot = await args.deps.sotRepository.get(args.docId);
  if (!existingSot) {
    throw new Error(`增量提交失败：SoT 不存在 (docId=${args.docId})`);
  }

  const mergedSot = mergeRecoveredBlocksIntoSot(existingSot, postProcessResult.sourceDoc);
  const parsed = DocumentSoTSchema.safeParse(mergedSot);
  if (!parsed.success) {
    throw new Error(`增量提交失败：合并后的 SoT schema 非法 (docId=${args.docId})`);
  }

  const points = buildQdrantPoints(args.docId, args.filename, vectorizedBlocks);
  const vectorDimension = vectorizedBlocks[0]?.vector.length ?? DEFAULT_VECTOR_DIMENSION;
  await args.deps.qdrantRepository.getOrCreateCollection(
    args.kbId,
    vectorDimension,
    'Cosine',
    true,
    {
      defaultSegmentNumber: resolveTargetSegmentCountByPointsCount(0),
    }
  );
  await args.deps.sotRepository.save(args.docId, mergedSot);
  let attemptedPointWrite = false;
  try {
    attemptedPointWrite = true;
    await args.deps.qdrantRepository.addPoints(args.kbId, points);

    const writtenCount = await args.deps.qdrantRepository.countPointsByIds(
      args.kbId,
      points.map(point => point.id)
    );
    if (writtenCount !== points.length) {
      throw new Error(`增量提交失败：新增向量点校验失败 (${writtenCount}/${points.length})`);
    }

    const updated = await args.deps.metadataRepository.updateDocumentParseDiagnostics(
      args.docId,
      args.nextDiagnostics
    );
    if (!updated) {
      throw new Error(`增量提交失败：更新 PDF 解析诊断失败 (docId=${args.docId})`);
    }
  } catch (error) {
    let rollbackError: unknown;
    if (attemptedPointWrite) {
      try {
        await args.deps.qdrantRepository.deletePointsByIds(
          args.kbId,
          points.map(point => point.id)
        );
      } catch (pointRollbackError) {
        rollbackError = pointRollbackError;
        logger.error(
          `增量回滚失败：删除本次新增向量点失败，但仍会继续恢复 SoT (docId=${args.docId})`,
          pointRollbackError
        );
      }
    }
    try {
      await args.deps.sotRepository.save(args.docId, existingSot);
    } catch (sotRollbackError) {
      logger.error(`增量回滚失败：恢复旧 SoT 失败 (docId=${args.docId})`, sotRollbackError);
      throw sotRollbackError;
    }
    if (rollbackError) {
      logger.warn(
        `增量回滚部分失败：Qdrant 本次新增点可能残留，将依赖下次幂等续跑自愈 (docId=${args.docId})`
      );
    }
    throw error;
  }
}

function toRawBlocks(blocks: ParsedBlock[]): RawBlock[] {
  return blocks.map(block => ({
    id: block.blockId,
    text: block.text,
    type: block.type,
    heading_level: readHeadingLevel(block.metadata),
    source_info: toRawSourceInfo(block.source_info),
    metadata: block.metadata ?? {},
  }));
}

function readHeadingLevel(metadata: Record<string, unknown> | undefined): number | undefined {
  const value = metadata?.heading_level;
  return typeof value === 'number' ? value : undefined;
}

function toRawSourceInfo(sourceInfo: ParsedBlock['source_info']): RawBlock['source_info'] {
  return {
    ...(sourceInfo ?? {}),
  };
}

async function vectorizeBlocks(
  embedding: EmbeddingPort,
  blocks: ParsedContentBlock[],
  embeddingModelId: string
): Promise<VectorizedBlock[]> {
  const texts = blocks.map(block => block.text.trim());
  const result = await embedding.embed({ modelId: embeddingModelId, values: texts });
  const vectors = result.vectors;
  const sparseVectors = await textsToSparseVectors(texts);
  return blocks.map((block, index) => ({
    ...block,
    text: texts[index],
    vector: [...vectors[index]],
    sparse_vector: sparseVectors[index],
    vectorModel: embeddingModelId,
    sparseVectorModel: 'bm25',
    vectorTimestamp: Date.now(),
  }));
}

function mergeRecoveredBlocksIntoSot(existing: DocumentSoT, recovered: DocumentSoT): DocumentSoT {
  const nextContentBlocks: Record<string, Block> = { ...existing.content_blocks };
  const nextRoot = existing.structure.root.filter(
    blockId => !recovered.structure.root.includes(blockId)
  );

  for (const blockId of recovered.structure.root) {
    const block = recovered.content_blocks[blockId];
    if (block) {
      nextContentBlocks[blockId] = block;
      nextRoot.push(blockId);
    }
  }
  const sortedRoot = sortRootByPage(nextRoot, nextContentBlocks);

  return {
    ...existing,
    metadata: {
      ...existing.metadata,
      parser_version: existing.metadata.parser_version,
      vision_model: existing.metadata.vision_model,
    },
    content_blocks: nextContentBlocks,
    structure: {
      ...existing.structure,
      root: sortedRoot,
      toc: mergeToc(existing.structure.toc, recovered.structure.toc),
    },
  };
}

function sortRootByPage(root: string[], contentBlocks: Record<string, Block>): string[] {
  return [...root].sort((leftId, rightId) => {
    const leftPage = contentBlocks[leftId]?.source_info?.page_num ?? Number.MAX_SAFE_INTEGER;
    const rightPage = contentBlocks[rightId]?.source_info?.page_num ?? Number.MAX_SAFE_INTEGER;
    if (leftPage !== rightPage) return leftPage - rightPage;
    return root.indexOf(leftId) - root.indexOf(rightId);
  });
}

function mergeToc(existing: unknown[] | undefined, recovered: unknown[] | undefined): unknown[] {
  return [...(existing ?? []), ...(recovered ?? [])];
}

function buildQdrantPoints(
  docId: string,
  filename: string,
  blocks: VectorizedBlock[]
): QdrantPoint[] {
  return blocks.map(block => {
    const vectorData: VectorData = {
      default: block.vector,
      bm25: block.sparse_vector,
    };
    return {
      id: block.id,
      vector: vectorData,
      payload: {
        doc_id: docId,
        block_id: block.id,
        document: block.text,
        doc_title: filename,
        block_type: block.block_type,
        page_number: block.source_info?.page_num,
        para_idx: block.source_info?.para_idx,
        ...(typeof block.parent_block_id === 'string'
          ? { parent_block_id: block.parent_block_id }
          : {}),
        ...(typeof block.part_index === 'number' ? { part_index: block.part_index } : {}),
        metadata: {
          source_info: block.source_info,
          continue_run_doc_id: docId,
        },
      },
    };
  });
}

function mergeDiagnosticsAfterRetry(
  current: DocumentParseDiagnostics,
  retry: {
    totalPages: number;
    recoveredPages: number[];
    failedAgain: DocumentParseDiagnostics['failedPages'];
  }
): DocumentParseDiagnostics {
  const recovered = new Set(retry.recoveredPages);
  const failedAgainByPage = new Map(retry.failedAgain.map(page => [page.pageNumber, page]));
  const failedPages = current.failedPages
    .filter(page => !recovered.has(page.pageNumber))
    .map(page => failedAgainByPage.get(page.pageNumber) ?? page);

  for (const page of retry.failedAgain) {
    if (!failedPages.some(item => item.pageNumber === page.pageNumber)) {
      failedPages.push(page);
    }
  }

  const parsedPages = Array.from(new Set([...current.parsedPages, ...retry.recoveredPages])).sort(
    (a, b) => a - b
  );

  return {
    ...current,
    pipeline: 'vision_page_image',
    totalPages: retry.totalPages,
    parsedPages,
    failedPages: failedPages.sort((a, b) => a.pageNumber - b.pageNumber),
    isPartial: failedPages.length > 0 && parsedPages.length > 0,
    createdAt: Date.now(),
  };
}
