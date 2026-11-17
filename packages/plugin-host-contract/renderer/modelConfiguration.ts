/** 用途身份只有这一份声明；Host 设置与插件只读视图共用。 */
export type ModelBindingSlot =
  | 'primary'
  | 'embedding'
  | 'rerank'
  | 'pdf_ocr'
  | 'image_vision'
  | 'image_generation'
  | 'transcription';

export type PluginModelPurpose = Extract<ModelBindingSlot, 'embedding' | 'rerank' | 'pdf_ocr' | 'image_vision'>;
export type PluginAuxiliaryModelPurpose = 'graph_extraction';

export interface EmbeddingModelChangeImpact {
  readonly id: string;
  readonly name: string;
  readonly documentCount: number;
}
export interface EmbeddingModelChangeImpactPort {
  findImpactedKnowledgeBases(nextModelId: string): Promise<readonly EmbeddingModelChangeImpact[]>;
  findKnowledgeBasesUsingModel(modelId: string): Promise<readonly EmbeddingModelChangeImpact[]>;
}

export interface RendererModelConfigurationPort {
  readPurposeModelId(purpose: PluginModelPurpose): string | null;
  readAuxiliaryModelId(purpose: PluginAuxiliaryModelPurpose): string | null;
  readModelDisplayName(modelId: string): string | null;
  subscribeChanges(listener: () => void): () => void;
  openModelConfiguration(): void;
  registerEmbeddingImpact(port: EmbeddingModelChangeImpactPort): () => void;
}

export declare function readPurposeModelId(purpose: PluginModelPurpose): string | null;
export declare function readAuxiliaryModelId(purpose: PluginAuxiliaryModelPurpose): string | null;
export declare function readModelDisplayName(modelId: string): string | null;
export declare function subscribeModelConfigurationChanges(listener: () => void): () => void;
export declare function openModelConfiguration(): void;
export declare function registerEmbeddingModelChangeImpactPort(port: EmbeddingModelChangeImpactPort): () => void;
