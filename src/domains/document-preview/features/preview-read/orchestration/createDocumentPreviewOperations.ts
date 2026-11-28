import {
  DocumentPreviewContentSchema,
  DocumentPreviewImageRequestSchema,
  DocumentPreviewRequestSchema,
  type DocumentPreviewContent,
  type DocumentPreviewImageRequest,
  type DocumentPreviewImageResult,
  type DocumentPreviewRequest,
  type DocumentPreviewResult,
} from '@app/schemas';
import type { DocumentPreviewDependencies } from '../../../definitions/documentPreview';
import { resolveDocumentPreviewCoverSize } from '../functions/resolveDocumentPreviewCoverSize';
import { resolveDocumentPreviewState } from '../functions/resolveDocumentPreviewState';

export function createDocumentPreviewOperations(deps: DocumentPreviewDependencies) {
  const pending = new Map<string, Promise<DocumentPreviewResult>>();
  const waiters: Array<() => void> = [];
  let active = 0;
  function currentResult(
    input: Pick<DocumentPreviewRequest, 'documentId' | 'projectId'>,
    content?: DocumentPreviewContent
  ): DocumentPreviewResult {
    const node = deps.readNode(input.documentId);
    const hasProvider = node ? deps.resolveProvider(node.nodeType) !== null : false;
    return resolveDocumentPreviewState({
      request: input,
      node,
      hasProvider,
      textSnapshot:
        !hasProvider && node?.projectId === input.projectId
          ? deps.readTextSnapshot(input.documentId)
          : null,
      ...(content ? { content } : {}),
    });
  }
  async function acquire(): Promise<void> {
    if (active < 2) {
      active += 1;
      return;
    }
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
    const nodeType = initial.nodeType;
    const provider = deps.resolveProvider(nodeType);
    if (!provider) return currentResult(input);
    // 内容与尺寸无关的类型（Markdown）按版本只存一份：悬停、输入框、画布卡和选中详情用的宽度各不相同，
    // 把宽度放进键里它们永远用不上彼此的结果。按尺寸出图的类型归到固定档位后再出图、再入键。
    const size = provider.sizeIndependent
      ? { widthPx: input.widthPx, pixelRatio: input.pixelRatio }
      : resolveDocumentPreviewCoverSize(input);
    const providerInput = { context: deps.context, documentId: input.documentId, ...size };
    const revision = await provider.getRevision(providerInput);
    const key = JSON.stringify([
      input.projectId,
      input.documentId,
      revision,
      ...(provider.sizeIndependent ? [] : [size.widthPx, size.pixelRatio]),
    ]);
    const admitCurrent = async (
      content: DocumentPreviewContent
    ): Promise<DocumentPreviewResult> => {
      const state = currentResult(input, content);
      if (state.status !== 'ready') return state;
      // 图片读取、缓存 IO 和 provider 渲染都会让出事件循环，正文/引用呈现须在发布时仍属同一版本。
      if ((await provider.getRevision(providerInput)) !== content.revisionKey)
        return currentResult(input);
      return currentResult(input, content);
    };
    const cached = await deps.cache.read(key);
    if (cached) return admitCurrent(cached);
    const existing = pending.get(key);
    if (existing) return existing;
    // 封面是派生内容；快速滚动不能积压数千个重型文稿渲染任务。
    if (pending.size >= 64) return currentResult(input);
    const result = (async (): Promise<DocumentPreviewResult> => {
      await acquire();
      try {
        const content = DocumentPreviewContentSchema.parse(await provider.render(providerInput));
        if (content.revisionKey !== revision) return currentResult(input);
        const admitted = await admitCurrent(content);
        if (admitted.status !== 'ready') return admitted;
        await deps.cache.write(key, content);
        return admitCurrent(content);
      } finally {
        pending.delete(key);
        release();
      }
    })();
    pending.set(key, result);
    return result;
  }
  /** 与 read 同一套范围规则：文档已删除、不在该项目或类型不可用时不读字节；异步返回后再核对一次。 */
  async function readImage(value: DocumentPreviewImageRequest): Promise<DocumentPreviewImageResult> {
    const input = DocumentPreviewImageRequestSchema.parse(value);
    const readable = () => {
      const state = currentResult(input);
      return state.status === 'preview_unavailable' && state.nodeType
        ? deps.resolveProvider(state.nodeType)
        : null;
    };
    const provider = readable();
    if (!provider?.readImage) return null;
    const image = await provider.readImage({
      context: deps.context,
      documentId: input.documentId,
      source: input.source,
      maxEdgePx: input.maxEdgePx,
    });
    return readable() === provider ? image : null;
  }
  return { read, readImage };
}
