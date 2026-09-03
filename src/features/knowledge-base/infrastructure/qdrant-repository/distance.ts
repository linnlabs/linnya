/**
 * @file src/features/knowledge-base/infrastructure/qdrant-repository/distance.ts
 *
 * @brief 距离度量字符串归一化
 */

import type { Distance } from '@infra/adapters/vector-store/qdrant';

/**
 * 功能：把用户/配置传入的字符串距离度量归一化成适配器可接受的枚举。
 */
export function normalizeDistanceMetric(distanceMetric?: string): Distance {
  if (distanceMetric === 'Cosine' || distanceMetric === 'Euclidean' || distanceMetric === 'Dot') {
    return distanceMetric;
  }
  return 'Cosine';
}



