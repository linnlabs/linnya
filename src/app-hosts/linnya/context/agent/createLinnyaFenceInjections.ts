import type { FenceInjection } from 'linnkit/context-manager';
import type { AgentInvokeRequest, AgentUserQuote } from './contracts';
import {
  createLinnyaFenceDescriptors,
  linnyaFenceRegistry,
} from './registerLinnyaFences';

const LOCAL_FENCE_CATEGORIES = new Map(
  createLinnyaFenceDescriptors().map(descriptor => [descriptor.kind, descriptor.category]),
);

export function createLinnyaFenceInjections(request: AgentInvokeRequest): FenceInjection[] {
  return [
    ...createProjectContextFences(request),
    ...createDocumentContextFences(request),
    ...createUserQuoteFences(request.user_quote),
    ...(request.fences ?? []),
  ];
}

export function withLinnyaFenceInjections(request: AgentInvokeRequest): AgentInvokeRequest {
  return {
    ...request,
    fences: createLinnyaFenceInjections(request),
  };
}

/**
 * 通用 child-run 自动继承父 run 当前轮的环境快照，但不继承临时选区、引用或泛化旧上下文。
 * kind 的产品分类仍由 Linnya Fence registry 拥有，不能在 child runtime 硬编码插件名称。
 */
export function createLinnyaChildRunContextInjections(
  request: AgentInvokeRequest,
): ReadonlyArray<FenceInjection> {
  return createLinnyaFenceInjections(request)
    .filter(injection => isChildRunEnvironmentFence(injection.kind))
    .map(injection => ({
      ...injection,
      ...(injection.attrs ? { attrs: { ...injection.attrs } } : {}),
      ...(injection.metadata ? { metadata: { ...injection.metadata } } : {}),
    }));
}

function isChildRunEnvironmentFence(kind: string): boolean {
  if (kind === 'project-context') return true;
  const localCategory = LOCAL_FENCE_CATEGORIES.get(kind);
  if (localCategory !== undefined) return localCategory === 'current-view';
  const descriptor = linnyaFenceRegistry.get(kind);
  return descriptor !== undefined
    && 'category' in descriptor
    && descriptor.category === 'current-view';
}

function createProjectContextFences(request: AgentInvokeRequest): FenceInjection[] {
  const projectName = request.project_metadata?.name?.trim();
  const projectDescription = request.project_metadata?.description?.trim();
  const documentList = request.document_list?.trim();
  if (!projectName && !projectDescription && !documentList) {
    return [];
  }

  const lines: string[] = [];
  if (projectName) lines.push(`project name: ${projectName}`);
  if (projectDescription) lines.push(`project description: ${projectDescription}`);
  if (documentList) {
    lines.push('project files:');
    lines.push(documentList);
  }

  return [{ kind: 'project-context', content: lines.join('\n') }];
}

function createDocumentContextFences(request: AgentInvokeRequest): FenceInjection[] {
  const fences: FenceInjection[] = [];
  const before = request.context_before?.trim();
  const after = request.context_after?.trim();
  const documentTitle = request.document_title?.trim();
  const documentFragment = request.document_fragment?.trim();
  const injectedContext = request.injected_context?.trim();

  const documentLines: string[] = [];
  if (before) {
    documentLines.push(before);
  }
  // 中文说明：pageContext 已经会输出 document_title=...，这里避免 document_metadata.title 再生成第二个标题块。
  if (documentTitle && !documentContextAlreadyMentionsTitle(documentLines, documentTitle)) {
    documentLines.push(`document title: ${documentTitle}`);
  }
  if (documentFragment) {
    documentLines.push('document fragment:');
    documentLines.push(documentFragment);
  }
  if (after) {
    documentLines.push(after);
  }
  if (documentLines.length > 0) {
    fences.push({ kind: 'document-context', content: documentLines.join('\n') });
  }

  if (injectedContext) {
    fences.push({ kind: 'additional-context', content: injectedContext });
  }

  return fences;
}

function documentContextAlreadyMentionsTitle(contextParts: string[], title: string): boolean {
  const normalizedTitle = normalizeContextText(title);
  if (!normalizedTitle) {
    return false;
  }

  return contextParts.some(part => {
    const normalizedPart = normalizeContextText(part);
    return (
      normalizedPart.includes(`document_title=${normalizedTitle}`) ||
      normalizedPart.includes(`document_title="${normalizedTitle}"`) ||
      normalizedPart.includes(`document title: ${normalizedTitle}`)
    );
  });
}

function normalizeContextText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function createUserQuoteFences(quote: AgentUserQuote | undefined): FenceInjection[] {
  if (!quote || quote.items.length === 0) {
    return [];
  }

  const quoteText = quote.items.map(item => item.text).join('\n\n').trim();
  if (!quoteText) {
    return [];
  }
  return [{
    kind: 'user-quote',
    content: quoteText,
    attrs: readUserQuoteAttrs(quote.items[0]?.source),
  }];
}

function readUserQuoteAttrs(source: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!source) {
    return {};
  }

  const attrs: Record<string, unknown> = {};
  const docId = readString(source, 'doc_id');
  const blockId = readString(source, 'block_id');
  const start = readNumber(source, 'start');
  const end = readNumber(source, 'end');

  if (docId) attrs.source_doc = docId;
  if (blockId) attrs.block_id = blockId;
  if (start !== undefined) attrs.start = start;
  if (end !== undefined) attrs.end = end;

  return attrs;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
