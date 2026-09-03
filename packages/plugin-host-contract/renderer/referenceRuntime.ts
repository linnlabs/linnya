import type { Ref } from 'vue';

export interface CitationKbSearchItem {
  readonly kbId: string;
  readonly kbName: string;
  readonly docId: string;
  readonly docTitle: string;
  readonly blockId?: string;
  readonly page?: number;
  readonly score: number;
  readonly text: string;
  readonly snippet: string;
}

export interface CitationKbSearchRequest {
  readonly kbIds: string[];
  readonly kbIdToName: Record<string, string>;
  readonly query: string;
  readonly topKPerKb?: number;
  readonly topKFinal?: number;
}

export interface CitationKbSearchResult {
  readonly results: CitationKbSearchItem[];
  readonly errorsByKbId: Record<string, string>;
  readonly hasPartialFailure?: boolean;
}

export interface WebManualFormInput {
  readonly url: string;
  readonly title: string;
  readonly authors: string;
  readonly date: string;
  readonly containerTitle: string;
  readonly snippet: string;
  readonly isManual: boolean;
}

export interface WebManualCitationFormStoreAdapter {
  readonly visible: boolean;
  readonly activeTab: string;
  readonly webManualForm: WebManualFormInput;
  updateWebManualForm<K extends keyof WebManualFormInput>(
    field: K,
    value: WebManualFormInput[K],
  ): void;
  setWebManualError(field: keyof WebManualFormInput, error: string | null): void;
  resetWebManualForm(): void;
}

export interface WebManualCitationFormRuntime {
  readonly sourceType: Ref<'web' | 'manual'>;
  readonly urlInputRef: Ref<HTMLInputElement | null>;
  readonly titleInputRef: Ref<HTMLInputElement | null>;
  readonly snippetTextareaRef: Ref<HTMLTextAreaElement | null>;
  handleSourceTypeChange(value: 'web' | 'manual'): void;
  handleFieldChange<K extends keyof WebManualFormInput>(
    field: K,
    value: WebManualFormInput[K],
  ): void;
  handleSnippetInput(event: Event): void;
  handleReset(): void;
}

export interface PluginKnowledgeBaseSummary {
  readonly id: string;
  readonly name: string;
}

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

export declare function registerRendererReferenceRuntimePort(port: RendererReferenceRuntimePort): void;
export declare function clearRendererReferenceRuntimePortForTest(): void;
export declare function searchInMultipleKbs(
  request: CitationKbSearchRequest,
): Promise<CitationKbSearchResult>;
export declare function useWebManualCitationForm(
  store: WebManualCitationFormStoreAdapter,
  activeTabId?: string,
): WebManualCitationFormRuntime;
export declare function validateWebManualForm(
  form: WebManualFormInput,
): Partial<Record<keyof WebManualFormInput, string>>;
export declare function listKnowledgeBasesForPlugin(): Promise<PluginKnowledgeBaseSummary[]>;
