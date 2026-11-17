import type { PluginInferencePort } from './inferenceRuntime';

/** Worker 仅使用当前知识库任务真正需要的操作；rerank 仍在 Backend 搜索执行。 */
export interface PluginWorkerInferencePort extends Pick<PluginInferencePort, 'embedding' | 'textGeneration' | 'documentOcr'> {
  dispose(): void;
}

export declare function createPluginWorkerInferencePort(): PluginWorkerInferencePort;
