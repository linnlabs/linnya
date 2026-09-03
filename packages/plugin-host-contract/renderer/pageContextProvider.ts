/** @deprecated page kind is a renderer registry string. Use `string`. */
export type RendererPageKind = string;

/** @deprecated document type is a renderer registry string. Use `string`. */
export type RendererPageContextDocumentType = string;

export interface RendererPageContextDocument {
  readonly id: string;
  readonly type: string;
  readonly title?: string;
}

export interface RendererPageContextSelection {
  readonly selectedText?: string;
  readonly selectedNodeIds?: string[];
  readonly selectedElementIds?: string[];
}

export interface RendererPageContextSummarySection {
  /**
   * 会被序列化为 `[sectionName]`，属于插件 owning 文档类型维护的 Agent 可见协议名。
   */
  readonly sectionName: string;
  readonly lines: readonly string[];
}

export interface RendererPageContextSummary {
  readonly sections: readonly RendererPageContextSummarySection[];
}

export interface RendererPageContextLike {
  readonly kind?: string;
  readonly document?: {
    readonly id: string;
    readonly type?: string;
    readonly title?: string;
  };
  readonly selection?: RendererPageContextSelection;
}

export interface RendererPageDocumentFragmentParams {
  readonly pageContext: RendererPageContextLike;
  /**
   * 这里描述调用发生在哪个渲染端界面，不是 runtime 执行模式。
   */
  readonly surface: 'sidebar';
}

export interface RendererPageContextProvider {
  readonly id: string;
  readonly kind: string;
  readonly documentType: string;
  readonly buildDocument?: () => RendererPageContextDocument | undefined;
  readonly buildSelection?: () => RendererPageContextSelection | undefined;
  readonly buildSummary?: () => RendererPageContextSummary | undefined;
  readonly buildDocumentFragment?: (
    params: RendererPageDocumentFragmentParams
  ) => Promise<string | null> | string | null;
}

export declare function registerRendererPageContextProvider(provider: RendererPageContextProvider): void;
export declare function unregisterRendererPageContextProvider(id: string): void;
export declare function getRendererPageContextProviderByKind(
  kind: string | undefined,
): RendererPageContextProvider | undefined;
export declare function getRendererPageContextProviderByDocumentType(
  documentType: string | undefined,
): RendererPageContextProvider | undefined;
export declare function getRendererPageContextProviderForContext(
  pageContext: RendererPageContextLike | undefined,
): RendererPageContextProvider | undefined;
export declare function listRendererPageContextProviders(): RendererPageContextProvider[];
export declare function clearRendererPageContextProvidersForTest(): void;
