export interface GenerateTextRequestParams {
  prompt: string;
  prompt_key?: string;
  model_id?: string;
  context_before?: string;
  context_after?: string;
  current_block_content?: string;
  document_fragment?: string;
  conversationId?: string;
  turn_id?: string;
  fences?: Array<{
    kind: string;
    content: string;
    attrs?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }>;
  conversationHistory?: unknown[];
  mode?: 'chat' | 'agent';
  persist?: boolean;
  history_mode?: 'isolated';
  run_lane?: 'foreground' | 'auxiliary';
  event_visibility?: 'conversation' | 'none';
  review_run_id?: string;
  agent_id?: string;
  chunk_index?: number;
  total_chunks?: number;
  review_background?: string;
  review_goal?: string;
  enableTools?: boolean;
  availableTools?: string[];
  completion_length_hint?: string;
  recent_rejections?: string[];
  behavior_summary?: string;
  intent_key?: string;
  intent_confidence?: number;
  intent_constraints?: string[];
  /** 思考努力程度（统一语义）；未传时从 modelsStore.primaryReasoningEffort 读取 */
  reasoning_effort?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
}

export interface GenerateTextResponse {
  generated_text: string;
}

export interface GenerateTextStreamCallbacks {
  onStart?: () => void;
  onChunk?: (chunk: string) => void;
  onComplete?: (fullText: string) => void;
  onError?: (error: Error) => void;
  onStreamEnd?: (eventData?: unknown) => void;
}

export function generateText(
  requestParams: GenerateTextRequestParams,
  signal?: AbortSignal | null,
): Promise<GenerateTextResponse>;

export function generateTextStream(
  requestParams: GenerateTextRequestParams,
  callbacks?: GenerateTextStreamCallbacks,
  signal?: AbortSignal | null,
): Promise<void>;
