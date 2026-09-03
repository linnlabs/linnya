/**
 * src/pipeline/index.ts
 * 
 * 导出Pipeline模块的公共API
 */

// 导出任务负载相关类型和验证函数
export {
  IngestionJobPayloadSchema,
  type IngestionJobPayload,
  GraphExtractionJobPayloadSchema,
  type GraphExtractionJobPayloadInput,
  type GraphExtractionJobPayload,
  GraphIndexingJobPayloadSchema,
  type GraphIndexingJobPayloadInput,
  type GraphIndexingJobPayload,
} from './jobs';

// 导出Worker处理函数
export { default as processIngestionJob } from './workers/ingestion.worker'; 
export { default as processGraphExtractionJob } from './workers/graph-extraction.worker';
export { default as processGraphIndexingJob } from './workers/graph-indexing.worker';
