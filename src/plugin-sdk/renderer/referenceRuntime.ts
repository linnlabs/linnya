/**
 * @file referenceRuntime.ts
 * @description 渲染端引用与 citation 输入契约 port。
 *
 * 中文说明：
 * - 插件 evidence UI 可以复用 editor citation 的输入结构；
 * - 这里暴露“引用搜索 / 表单校验 / KB 列表”的窄能力，避免插件包直接依赖
 *   editor、knowledgebase、shared composable 的内部路径。
 * - 真实 host 实现由 renderer app 启动时注册，SDK 不反向 import 业务域。
 */

import type { Ref } from 'vue';

export interface CitationKbSearchItem {
  kbId: string;
  kbName: string;
  docId: string;
  docTitle: string;
  blockId?: string;
  page?: number;
  score: number;
  text: string;
  snippet: string;
}

export interface CitationKbSearchRequest {
  kbIds: string[];
  kbIdToName: Record<string, string>;
  query: string;
  topKPerKb?: number;
  topKFinal?: number;
}

export interface CitationKbSearchResult {
  results: CitationKbSearchItem[];
  errorsByKbId: Record<string, string>;
  hasPartialFailure?: boolean;
}

export interface WebManualFormInput {
  url: string;
  title: string;
  authors: string;
  date: string;
  containerTitle: string;
  snippet: string;
  isManual: boolean;
}

export interface WebManualCitationFormStoreAdapter {
  visible: boolean;
  activeTab: string;
  webManualForm: WebManualFormInput;
  updateWebManualForm<K extends keyof WebManualFormInput>(
    field: K,
    value: WebManualFormInput[K],
  ): void;
  setWebManualError(field: keyof WebManualFormInput, error: string | null): void;
  resetWebManualForm(): void;
}

export interface WebManualCitationFormRuntime {
  sourceType: Ref<'web' | 'manual'>;
  urlInputRef: Ref<HTMLInputElement | null>;
  titleInputRef: Ref<HTMLInputElement | null>;
  snippetTextareaRef: Ref<HTMLTextAreaElement | null>;
  handleSourceTypeChange(value: 'web' | 'manual'): void;
  handleFieldChange<K extends keyof WebManualFormInput>(
    field: K,
    value: WebManualFormInput[K],
  ): void;
  handleSnippetInput(event: Event): void;
  handleReset(): void;
}

export type PluginKnowledgeBaseSummary = {
  id: string;
  name: string;
};

export interface RendererReferenceRuntimePort {
  searchInMultipleKbs(request: CitationKbSearchRequest): Promise<CitationKbSearchResult>;
  useWebManualCitationForm(
    store: WebManualCitationFormStoreAdapter,
    activeTabId?: string,
  ): WebManualCitationFormRuntime;
  validateWebManualForm(
    form: WebManualFormInput,
  ): Partial<Record<keyof WebManualFormInput, string>>;
  listKnowledgeBasesForPlugin(): Promise<PluginKnowledgeBaseSummary[]>;
}

let referenceRuntimePort: RendererReferenceRuntimePort | null = null;

export function registerRendererReferenceRuntimePort(port: RendererReferenceRuntimePort): void {
  referenceRuntimePort = port;
}

export function clearRendererReferenceRuntimePortForTest(): void {
  referenceRuntimePort = null;
}

function requireRendererReferenceRuntimePort(): RendererReferenceRuntimePort {
  if (!referenceRuntimePort) {
    throw new Error('[plugin-sdk/referenceRuntime] reference runtime port 尚未注册');
  }
  return referenceRuntimePort;
}

export function searchInMultipleKbs(
  request: CitationKbSearchRequest,
): Promise<CitationKbSearchResult> {
  return requireRendererReferenceRuntimePort().searchInMultipleKbs(request);
}

export function useWebManualCitationForm(
  store: WebManualCitationFormStoreAdapter,
  activeTabId?: string,
): WebManualCitationFormRuntime {
  return requireRendererReferenceRuntimePort().useWebManualCitationForm(store, activeTabId);
}

export function validateWebManualForm(
  form: WebManualFormInput,
): Partial<Record<keyof WebManualFormInput, string>> {
  return requireRendererReferenceRuntimePort().validateWebManualForm(form);
}

export async function listKnowledgeBasesForPlugin(): Promise<PluginKnowledgeBaseSummary[]> {
  return requireRendererReferenceRuntimePort().listKnowledgeBasesForPlugin();
}
