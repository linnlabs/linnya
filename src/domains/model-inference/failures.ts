// 业务错误分类和内联 Worker 共用原错误身份，不带入推理校验或 Provider 实现。
export { TextGenerationFailure } from './features/text-generation/definitions/textGeneration';
export { EmbeddingFailure } from './features/embedding/definitions/embedding';
export { RerankingFailure } from './features/reranking/definitions/reranking';
