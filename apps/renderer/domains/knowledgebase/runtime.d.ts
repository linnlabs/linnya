import type { KnowledgeBaseRuntime } from './definitions/knowledgeBaseRuntime';

/** 每个 Pinia owner 的公开命令与只读状态，不暴露内部写 action。 */
export declare function useKnowledgeBase(): KnowledgeBaseRuntime;
