import { DocumentPreviewContentSchema, DocumentPreviewRequestSchema, type DocumentPreviewContent, type DocumentPreviewRequest, type DocumentPreviewResult } from '@app/schemas';
import type { DocumentPreviewDependencies } from '../../../definitions/documentPreview';
import { resolveDocumentPreviewState } from '../functions/resolveDocumentPreviewState';

export function createDocumentPreviewOperations(deps: DocumentPreviewDependencies) {
  const pending = new Map<string, Promise<DocumentPreviewResult>>();
  const waiters: Array<() => void> = [];
  let active = 0;
  function currentResult(input: DocumentPreviewRequest, content?: DocumentPreviewContent): DocumentPreviewResult {
    const node = deps.readNode(input.documentId);
    const hasProvider = node ? deps.resolveProvider(node.nodeType) !== null : false;
    return resolveDocumentPreviewState({ request: input, node, hasProvider, textSnapshot: !hasProvider && node?.projectId === input.projectId ? deps.readTextSnapshot(input.documentId) : null, ...(content ? { content } : {}) });
  }
  async function acquire(): Promise<void> {
    if (active < 2) { active += 1; return; }
    await new Promise<void>(resolve => waiters.push(resolve));
  }
  function release(): void {
    const next = waiters.shift();
    if (next) next();
    else active -= 1;
  }
  async function read(value: DocumentPreviewRequest): Promise<DocumentPreviewResult> {
    const input = DocumentPreviewRequestSchema.parse(value);
    const initial = currentResult(input);
    if (initial.status !== 'preview_unavailable' || !initial.nodeType) return initial;
    const provider = deps.resolveProvider(initial.nodeType);
    if (!provider) return currentResult(input);
    const providerInput = { context: deps.context, documentId: input.documentId, widthPx: input.widthPx, pixelRatio: input.pixelRatio };
    const revision = await provider.getRevision(providerInput);
    const key = JSON.stringify([input.documentId, revision, input.widthPx, input.pixelRatio]);
    const cached = await deps.cache.read(key);
    if (cached) return currentResult(input, cached);
    const existing = pending.get(key);
    if (existing) return existing;
    // 封面是派生内容；快速滚动不能积压数千个重型文稿渲染任务。
    if (pending.size >= 64) return currentResult(input);
    const result = (async (): Promise<DocumentPreviewResult> => {
      await acquire();
      try {
        const content = DocumentPreviewContentSchema.parse(await provider.render(providerInput));
        if (content.revisionKey !== revision) return currentResult(input);
        const admitted = currentResult(input, content);
        if (admitted.status !== 'ready') return admitted;
        await deps.cache.write(key, content);
        return currentResult(input, content);
      } finally { pending.delete(key); release(); }
    })();
    pending.set(key, result);
    return result;
  }
  return { read };
}
