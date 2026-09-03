import { Logger } from 'src/shared/logger';

import type { DocumentSoT } from '../domain/block';
import { Document, DocumentStatus } from '../domain/document';
import { MetadataRepository } from '../infrastructure/metadataRepository';
import { SotRepository } from '../infrastructure/sotRepository';

const logger = new Logger('FailureCleanup');

const MAX_SAMPLE_DOC_IDS = 20;
const MAX_SAMPLE_FAILURES = 10;

type DocIdBucket = {
  count: number;
  sampleDocIds: string[];
};

type FailureDetail = {
  docId: string;
  reason: string;
};

export type ConsistencyScanReport = {
  scannedDocs: number;
  completedHealthy: number;
  pendingCorrectedToCompleted: DocIdBucket;
  pendingCorrectedToFailed: DocIdBucket;
  pendingPartialData: DocIdBucket;
  completedMissingData: DocIdBucket;
  failedWithResidualData: DocIdBucket;
  failedWithoutData: DocIdBucket;
  orphanRepaired: DocIdBucket;
  orphanUnrepairable: DocIdBucket;
  statusCorrectionFailures: FailureDetail[];
  checkFailures: FailureDetail[];
};

function createDocIdBucket(): DocIdBucket {
  return {
    count: 0,
    sampleDocIds: []
  };
}

function recordDocId(bucket: DocIdBucket, docId: string): void {
  bucket.count += 1;
  if (bucket.sampleDocIds.length < MAX_SAMPLE_DOC_IDS) {
    bucket.sampleDocIds.push(docId);
  }
}

function recordFailureDetail(details: FailureDetail[], docId: string, reason: string): void {
  if (details.length >= MAX_SAMPLE_FAILURES) return;
  details.push({ docId, reason });
}

function summarizeDocBucket(bucket: DocIdBucket): {
  count: number;
  sampleDocIds: string[];
  omittedDocIds: number;
} {
  return {
    count: bucket.count,
    sampleDocIds: bucket.sampleDocIds,
    omittedDocIds: Math.max(0, bucket.count - bucket.sampleDocIds.length)
  };
}

function createConsistencyScanReport(scannedDocs: number): ConsistencyScanReport {
  return {
    scannedDocs,
    completedHealthy: 0,
    pendingCorrectedToCompleted: createDocIdBucket(),
    pendingCorrectedToFailed: createDocIdBucket(),
    pendingPartialData: createDocIdBucket(),
    completedMissingData: createDocIdBucket(),
    failedWithResidualData: createDocIdBucket(),
    failedWithoutData: createDocIdBucket(),
    orphanRepaired: createDocIdBucket(),
    orphanUnrepairable: createDocIdBucket(),
    statusCorrectionFailures: [],
    checkFailures: []
  };
}

function emitDocBucketLog(level: 'info' | 'warn', message: string, bucket: DocIdBucket): void {
  if (bucket.count === 0) return;
  const data = summarizeDocBucket(bucket);
  if (level === 'warn') {
    logger.warn(message, data);
    return;
  }
  logger.info(message, data);
}

function emitFailureDetailsLog(level: 'warn' | 'error', message: string, details: FailureDetail[]): void {
  if (details.length === 0) return;
  if (level === 'error') {
    logger.error(message, details);
    return;
  }
  logger.warn(message, details);
}

export function emitConsistencyScanLogs(params: {
  metadataCount: number;
  sotCount: number;
  qdrantCount: number;
  cleanupCandidateCount: number;
  report: ConsistencyScanReport;
}): void {
  const { metadataCount, sotCount, qdrantCount, cleanupCandidateCount, report } = params;

  logger.info('[FailureCleanup] 📋 一致性检查汇总', {
    scannedDocs: report.scannedDocs,
    sources: {
      metadata: metadataCount,
      sot: sotCount,
      qdrant: qdrantCount
    },
    healthy: {
      completed: report.completedHealthy
    },
    corrected: {
      pendingToCompleted: report.pendingCorrectedToCompleted.count,
      pendingToFailed: report.pendingCorrectedToFailed.count,
      orphanMetadataRepaired: report.orphanRepaired.count
    },
    anomalies: {
      pendingPartialData: report.pendingPartialData.count,
      completedMissingData: report.completedMissingData.count,
      failedWithResidualData: report.failedWithResidualData.count,
      failedWithoutData: report.failedWithoutData.count,
      orphanUnrepairable: report.orphanUnrepairable.count,
      statusCorrectionFailures: report.statusCorrectionFailures.length,
      checkFailures: report.checkFailures.length
    },
    cleanupCandidateCount
  });

  emitDocBucketLog(
    'info',
    '[FailureCleanup] 🔁 状态纠偏汇总: pending/processing -> completed',
    report.pendingCorrectedToCompleted
  );
  emitDocBucketLog(
    'info',
    '[FailureCleanup] 🔁 状态纠偏汇总: pending/processing -> failed',
    report.pendingCorrectedToFailed
  );
  emitDocBucketLog(
    'info',
    '[FailureCleanup] 🔁 孤儿元数据修复汇总',
    report.orphanRepaired
  );

  emitDocBucketLog(
    'warn',
    '[FailureCleanup] ⚠️ 待清理分类: pending/processing 仅部分数据存在',
    report.pendingPartialData
  );
  emitDocBucketLog(
    'warn',
    '[FailureCleanup] ⚠️ 待清理分类: completed 文档缺少 SoT 或 Qdrant 数据',
    report.completedMissingData
  );
  emitDocBucketLog(
    'warn',
    '[FailureCleanup] ⚠️ 待清理分类: failed 文档仍残留数据',
    report.failedWithResidualData
  );
  emitDocBucketLog(
    'warn',
    '[FailureCleanup] ⚠️ 待清理分类: failed 文档仅剩元数据',
    report.failedWithoutData
  );
  emitDocBucketLog(
    'warn',
    '[FailureCleanup] ⚠️ 待清理分类: 孤儿数据无法自动修复',
    report.orphanUnrepairable
  );
  emitFailureDetailsLog(
    'warn',
    '[FailureCleanup] ⚠️ 状态纠偏失败明细',
    report.statusCorrectionFailures
  );
  emitFailureDetailsLog(
    'warn',
    '[FailureCleanup] ⚠️ 文档一致性检查失败明细',
    report.checkFailures
  );
}

async function repairOrphanMetadataIfPossible(params: {
  docId: string;
  kbIdCandidates: string[];
  metadataRepository: MetadataRepository;
  sotRepository: SotRepository;
}): Promise<{ repaired: boolean; kbId?: string; filename?: string }> {
  const { docId, kbIdCandidates, metadataRepository, sotRepository } = params;

  const sot = (await sotRepository.get(docId)) as DocumentSoT | undefined;
  if (!sot) return { repaired: false };

  const filenameFromSot = typeof sot.metadata.source_file === 'string' ? sot.metadata.source_file.trim() : '';
  const filename = filenameFromSot.length > 0 ? filenameFromSot : `未知文件-${docId}`;

  const ingestionTsMs =
    typeof sot.metadata.ingestion_timestamp === 'number'
      ? sot.metadata.ingestion_timestamp
      : undefined;
  const createdAtSeconds = typeof ingestionTsMs === 'number' ? ingestionTsMs / 1000 : Date.now() / 1000;

  const fileSizeBytes =
    typeof sot.metadata.file_size === 'number' && Number.isFinite(sot.metadata.file_size) && sot.metadata.file_size >= 0
      ? sot.metadata.file_size
      : 0;

  const kbId =
    kbIdCandidates.length > 0 && kbIdCandidates[0].trim().length > 0
      ? kbIdCandidates[0].trim()
      : 'default';

  if (kbIdCandidates.length > 1) {
    logger.warn(
      `[FailureCleanup] ⚠️ 孤儿文档 ${docId} 同时出现在多个集合中：${kbIdCandidates.join(', ')}，将使用 ${kbId} 重建元数据`
    );
  }

  const repairedDoc: Document = {
    id: docId,
    kbId,
    filename,
    fileSize: fileSizeBytes,
    status: DocumentStatus.COMPLETED,
    createdAt: createdAtSeconds,
    updatedAt: createdAtSeconds,
    errorMessage: null,
    taskId: null
  };

  await metadataRepository.addDocument(repairedDoc);
  await metadataRepository.updateDocumentStatus(docId, DocumentStatus.COMPLETED);

  return { repaired: true, kbId, filename };
}

export async function analyzeDocumentConsistency(params: {
  metadataById: Map<string, Document>;
  metadataRepository: MetadataRepository;
  sotRepository: SotRepository;
  metadataIds: Set<string>;
  sotIds: Set<string>;
  qdrantDocIds: Set<string>;
  qdrantDocIdsByKb: Map<string, Set<string>>;
}): Promise<{
  failedDocIds: Set<string>;
  report: ConsistencyScanReport;
}> {
  const {
    metadataById,
    metadataRepository,
    sotRepository,
    metadataIds,
    sotIds,
    qdrantDocIds,
    qdrantDocIdsByKb
  } = params;

  const failedDocIds = new Set<string>();
  const allDocIds = new Set([...Array.from(metadataIds), ...Array.from(sotIds), ...Array.from(qdrantDocIds)]);

  logger.info(`[FailureCleanup] 🔍 开始检查 ${allDocIds.size} 个文档的数据一致性...`);

  const report = createConsistencyScanReport(allDocIds.size);

  for (const docId of allDocIds) {
    try {
      const meta = metadataById.get(docId);
      const inSot = sotIds.has(docId);
      const inQdrant = qdrantDocIds.has(docId);

      if (meta) {
        const isPendingLike = meta.status === 'pending' || meta.status === 'processing';
        const isCompleted = meta.status === 'completed';
        const isFailed = meta.status === 'failed';

        if (isPendingLike) {
          if (inSot && inQdrant) {
            try {
              const ok = await metadataRepository.updateDocumentStatus(docId, DocumentStatus.COMPLETED);
              if (ok) {
                recordDocId(report.pendingCorrectedToCompleted, docId);
              } else {
                recordFailureDetail(
                  report.statusCorrectionFailures,
                  docId,
                  'pending/processing -> completed 未生效'
                );
              }
            } catch (e) {
              recordFailureDetail(
                report.statusCorrectionFailures,
                docId,
                e instanceof Error ? `pending/processing -> completed 失败: ${e.message}` : String(e)
              );
            }
            continue;
          }

          if (!inSot && !inQdrant) {
            try {
              const ok = await metadataRepository.updateDocumentStatus(
                docId,
                DocumentStatus.FAILED,
                '启动纠偏：未完成且无数据，自动标记失败'
              );
              if (ok) {
                recordDocId(report.pendingCorrectedToFailed, docId);
              } else {
                recordFailureDetail(
                  report.statusCorrectionFailures,
                  docId,
                  'pending/processing -> failed 未生效'
                );
              }
            } catch (e) {
              recordFailureDetail(
                report.statusCorrectionFailures,
                docId,
                e instanceof Error ? `pending/processing -> failed 失败: ${e.message}` : String(e)
              );
            }

            failedDocIds.add(docId);
            continue;
          }

          if ((inSot && !inQdrant) || (!inSot && inQdrant)) {
            recordDocId(report.pendingPartialData, docId);
            failedDocIds.add(docId);
            continue;
          }
        }

        if (isCompleted && (!inSot || !inQdrant)) {
          recordDocId(report.completedMissingData, docId);
          failedDocIds.add(docId);
          continue;
        }

        if (isCompleted && inSot && inQdrant) {
          report.completedHealthy += 1;
          continue;
        }

        if (isFailed && (inSot || inQdrant)) {
          recordDocId(report.failedWithResidualData, docId);
          failedDocIds.add(docId);
          continue;
        }

        if (isFailed && !inSot && !inQdrant) {
          recordDocId(report.failedWithoutData, docId);
          failedDocIds.add(docId);
          continue;
        }
      } else if (inSot || inQdrant) {
        const kbIdsFromQdrant: string[] = [];
        for (const [kbId, ids] of qdrantDocIdsByKb.entries()) {
          if (ids.has(docId)) kbIdsFromQdrant.push(kbId);
        }

        const repaired = await repairOrphanMetadataIfPossible({
          docId,
          kbIdCandidates: kbIdsFromQdrant,
          metadataRepository,
          sotRepository
        });

        if (repaired.repaired) {
          recordDocId(report.orphanRepaired, docId);
          continue;
        }

        recordDocId(report.orphanUnrepairable, docId);
        failedDocIds.add(docId);
      }
    } catch (checkErr) {
      recordFailureDetail(
        report.checkFailures,
        docId,
        checkErr instanceof Error ? checkErr.message : String(checkErr)
      );
    }
  }

  return {
    failedDocIds,
    report
  };
}
