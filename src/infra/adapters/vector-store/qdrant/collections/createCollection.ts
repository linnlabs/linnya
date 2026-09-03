/**
 * @file src/infra/adapters/vector-store/qdrant/collections/createCollection.ts
 *
 * @brief 创建集合（使用 HTTP PUT，避免依赖第三方 SDK 的类型暴露不完整问题）
 */

import type { Logger } from 'src/shared/logger';
import type {
  CreateCollectionOptions,
  Distance,
  MultiVectorCollectionConfig,
  QdrantConfig,
} from '../types';

function normalizeDistance(distance: string | undefined): Distance {
  if (distance === 'Cosine' || distance === 'Euclidean' || distance === 'Dot') return distance;
  return 'Cosine';
}

function buildCreateCollectionBody(
  vectorConfigOrSize: number | MultiVectorCollectionConfig,
  distance: Distance,
  options?: CreateCollectionOptions
): Record<string, unknown> {
  const defaultSegmentNumber = options?.optimizerConfig?.defaultSegmentNumber;
  const hasExplicitDefaultSegmentNumber =
    typeof defaultSegmentNumber === 'number' &&
    Number.isFinite(defaultSegmentNumber) &&
    defaultSegmentNumber >= 0;

  // 单向量：统一创建为命名向量 default，避免 schema 不一致
  if (typeof vectorConfigOrSize === 'number') {
    const body: Record<string, unknown> = {
      vectors: {
        default: {
          size: vectorConfigOrSize,
          distance
        }
      }
    };

    if (hasExplicitDefaultSegmentNumber) {
      body['optimizers_config'] = {
        default_segment_number: Math.trunc(defaultSegmentNumber),
      };
    }

    return body;
  }

  // 多向量：default（稠密）放 vectors；bm25（稀疏）放 sparse_vectors
  const cfg = vectorConfigOrSize;
  const body: Record<string, unknown> = {
    vectors: {
      default: {
        size: cfg.default.size,
        distance: normalizeDistance(cfg.default.distance)
      }
    }
  };

  if (cfg.bm25) {
    body['sparse_vectors'] = { bm25: {} };
  }

  if (hasExplicitDefaultSegmentNumber) {
    body['optimizers_config'] = {
      default_segment_number: Math.trunc(defaultSegmentNumber),
    };
  }

  return body;
}

export async function createCollectionImpl(
  qdrantConfig: QdrantConfig,
  collectionName: string,
  vectorConfigOrSize: number | MultiVectorCollectionConfig,
  distance: Distance,
  logger: Logger,
  options?: CreateCollectionOptions
): Promise<void> {
  const createCollectionBody = buildCreateCollectionBody(vectorConfigOrSize, distance, options);
  logger.info(`[QdrantAdapter] Creating collection: ${collectionName}`);
  logger.info(`[QdrantAdapter] Collection config: ${JSON.stringify(createCollectionBody, null, 2)}`);

  const response = await fetch(`${qdrantConfig.url}/collections/${collectionName}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(qdrantConfig.apiKey ? { Authorization: `Bearer ${qdrantConfig.apiKey}` } : {})
    },
    body: JSON.stringify(createCollectionBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`createCollection HTTP ${response.status}: ${errorText}`);
  }

  logger.info(`[QdrantAdapter] Collection created: ${collectionName}`);
}



