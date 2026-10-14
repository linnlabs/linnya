import { z } from 'zod';

const WorkerVectorEndpointSchema = z.object({
  envVars: z.object({ QDRANT_URL: z.string().url() }),
});

/** 向量 Worker 只能消费队列 owner 注入的地址，不能猜默认端口或读进程环境。 */
export function resolveWorkerQdrantUrl(workerData: unknown): string {
  return WorkerVectorEndpointSchema.parse(workerData).envVars.QDRANT_URL;
}
