/**
 * @file pageContextProvider.ts
 * @description 渲染端插件页面上下文 provider 契约。
 *
 * 中文说明：
 * - conversation 只认识 page_context 契约，不直接读取插件 store；
 * - 插件按文档类型注册“文档信息 / 选区 / document_fragment”能力；
 * - provider 必须保持窄小，不能演变成跨 domain 的大对象。
 */

import type {
  RendererPageContextLike,
  RendererPageContextProvider,
} from '@linnya/plugin-host-contract/renderer/pageContextProvider';

export type {
  RendererPageContextDocument,
  RendererPageContextDocumentType,
  RendererPageContextLike,
  RendererPageContextProvider,
  RendererPageContextSelection,
  RendererPageContextSummary,
  RendererPageContextSummarySection,
  RendererPageDocumentFragmentParams,
  RendererPageKind,
} from '@linnya/plugin-host-contract/renderer/pageContextProvider';

const providersById = new Map<string, RendererPageContextProvider>();
const providerIdsByKind = new Map<string, string>();
const providerIdsByDocumentType = new Map<string, string>();

export function registerRendererPageContextProvider(
  provider: RendererPageContextProvider
): void {
  if (providersById.has(provider.id)) return;

  const existingKindProviderId = providerIdsByKind.get(provider.kind);
  if (existingKindProviderId) {
    throw new Error(
      `[page-context-provider] 页面类型 ${provider.kind} 已由 ${existingKindProviderId} 注册`
    );
  }

  const existingDocumentTypeProviderId = providerIdsByDocumentType.get(provider.documentType);
  if (existingDocumentTypeProviderId) {
    throw new Error(
      `[page-context-provider] 文档类型 ${provider.documentType} 已由 ${existingDocumentTypeProviderId} 注册`
    );
  }

  providersById.set(provider.id, provider);
  providerIdsByKind.set(provider.kind, provider.id);
  providerIdsByDocumentType.set(provider.documentType, provider.id);
}

export function unregisterRendererPageContextProvider(id: string): void {
  const provider = providersById.get(id);
  if (!provider) return;
  providersById.delete(id);
  if (providerIdsByKind.get(provider.kind) === id) {
    providerIdsByKind.delete(provider.kind);
  }
  if (providerIdsByDocumentType.get(provider.documentType) === id) {
    providerIdsByDocumentType.delete(provider.documentType);
  }
}

export function getRendererPageContextProviderByKind(
  kind: string | undefined
): RendererPageContextProvider | undefined {
  if (!kind) return undefined;
  const providerId = providerIdsByKind.get(kind);
  return providerId ? providersById.get(providerId) : undefined;
}

export function getRendererPageContextProviderByDocumentType(
  documentType: string | undefined
): RendererPageContextProvider | undefined {
  if (!documentType) return undefined;
  const providerId = providerIdsByDocumentType.get(documentType);
  return providerId ? providersById.get(providerId) : undefined;
}

export function getRendererPageContextProviderForContext(
  pageContext: RendererPageContextLike | undefined
): RendererPageContextProvider | undefined {
  if (!pageContext) return undefined;
  return (
    getRendererPageContextProviderByDocumentType(pageContext.document?.type) ??
    getRendererPageContextProviderByKind(pageContext.kind)
  );
}

export function listRendererPageContextProviders(): RendererPageContextProvider[] {
  return Array.from(providersById.values());
}

export function clearRendererPageContextProvidersForTest(): void {
  providersById.clear();
  providerIdsByKind.clear();
  providerIdsByDocumentType.clear();
}
