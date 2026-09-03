/**
 * 编辑器批注通过 conversation domain 发起 AI run 时使用的稳定契约。
 * `mode` 当前只有 Agent 执行一种真实入口，新增模式前必须先明确对应的后端语义。
 */
export interface AnnotationRunParams {
  prompt: string;
  mode: 'agent';
  options: {
    promptKey?: string;
    model_id?: string;
    context?: {
      contextBefore?: string;
      contextAfter?: string;
    };
    current_paragraph?: string;
    enableTools?: boolean;
    metadata?: {
      targetPosition?: number;
    };
  };
  /** false 表示仅写回编辑器，不在侧边栏会话中持久化任务。 */
  persistToConversation?: boolean;
  streamHandlers: {
    onStreamChunk: (text: string) => void;
    onTransportEnd: (success: boolean, reason?: string) => void;
    onError: (message: string, type: 'stream_error' | 'api_error') => void;
    onOpen?: () => void;
  };
}
