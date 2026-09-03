import type { AgentSpecContextPolicy } from '@linnlabs/linnkit/contracts';
import type { AgentInvocationRequest } from '@linnlabs/linnkit/ports';

export type PromptKey = string;

export type PromptTemplateType = 'agent' | 'chat' | 'internal';

export declare enum PromptType {
  AGENT = 'agent',
  CHAT = 'chat',
  INTERNAL = 'internal',
}

export interface PromptTemplate {
  readonly id: PromptKey;
  readonly type: PromptTemplateType;
  readonly content: string;
  readonly description?: string;
  readonly variables?: string[];
}

export type TemplateVariables = Record<string, string | number | boolean | undefined>;

export type AgentModelPolicy =
  | { readonly kind: 'user_primary' }
  | { readonly kind: 'user_auxiliary' }
  | { readonly kind: 'inherit_parent' }
  | { readonly kind: 'fixed'; readonly modelId: string }
  | { readonly kind: 'by_capability'; readonly capability: string }
  | { readonly kind: 'kb_vision' }
  | { readonly kind: 'kb_pdf_ocr'; readonly defaultCapability?: string }
  | { readonly kind: 'kb_image_vision' };

export type AgentStepPolicy =
  | {
      readonly kind: 'final_answer';
      readonly lastStepsHintThreshold?: number;
    }
  | {
      readonly kind: 'force_tools';
      readonly lastStepsHintThreshold?: number;
      readonly forcedTools?: readonly string[];
    };

export interface AgentSkillPolicy {
  readonly enabled?: boolean;
  readonly requiredSkills?: readonly string[];
}

export interface AgentConfiguration {
  readonly availableTools?: readonly string[];
  readonly enableTools?: boolean;
  readonly knowledgeBaseId?: string;
  readonly defaultModelId?: string;
  readonly modelPolicy?: AgentModelPolicy;
  readonly preferredModelCapability?: string;
  /** 当前 Agent 单次 execution 的 Graph 节点预算；未声明时使用 Linnkit 框架默认值。 */
  readonly maxSteps?: number;
  readonly stepPolicy?: AgentStepPolicy;
  readonly skill?: AgentSkillPolicy;
  readonly contextPolicy?: AgentSpecContextPolicy;
}

export interface AgentTaskConfiguration {
  readonly systemPromptBuilder?: (request: AgentInvocationRequest) => string;
  readonly responseProcessor?: (rawResponse: string) => string;
  readonly streamChunkProcessor?: (chunk: string) => string;
}

export interface AgentDefinition {
  readonly id: PromptKey;
  readonly promptKey: PromptKey;
  readonly defaultMode: 'agent';
  readonly description: string;
  readonly config?: AgentConfiguration;
  readonly task?: AgentTaskConfiguration;
}

export interface SubagentTypeContribution {
  readonly type: string;
  readonly promptKey: PromptKey;
  readonly description: string;
  /**
   * 子 Agent 可继承的父会话末尾 turn 数。
   *
   * 默认值为 0，保持隔离执行。只有角色确实依赖父会话上下文时才显式声明；
   * 该策略由注册方拥有，不作为模型可修改的工具参数。
   */
  readonly inheritTurns?: number;
}

export declare function buildPrompt(template: PromptTemplate, variables?: TemplateVariables): string;

export declare function getCurrentTimeForPromptByDay(): string;
