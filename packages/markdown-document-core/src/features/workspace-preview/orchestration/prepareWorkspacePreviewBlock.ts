import { MarkdownChartSpecSchema } from '@app/schemas';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { DocumentPreviewImageSource } from '@app/schemas';
import type { WorkspaceMarkdownPreviewInput } from '../definitions/workspacePreview';

/** 已按清单尺寸占位、还没有字节的正文图片。 */
export interface PendingWorkspacePreviewImage {
  readonly image: HTMLImageElement;
  readonly source: DocumentPreviewImageSource;
}

/** 字体/图片就绪后再测量；取消不等待屏下资源，也不会留下挂在document上的测量节点。 */
export async function waitForPreviewResource<T>(promise: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Preview cancelled', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** 准备块内自带的重内容（图表），并列出块里等字节的正文图片；何时加载这些图片由调用方按首屏/全文决定。 */
export async function prepareWorkspacePreviewBlock(
  root: ProseMirrorNode, element: HTMLElement, input: WorkspaceMarkdownPreviewInput,
): Promise<readonly PendingWorkspacePreviewImage[]> {
  const chart = root.firstChild;
  if (chart?.type.name === 'chartBlock') {
    const { renderChartImageSvg, baseChartTheme } = await import('../../workspace-charts');
    input.signal.throwIfAborted();
    const spec = MarkdownChartSpecSchema.parse(chart.attrs.spec);
    const locale = input.locale ?? 'zh-CN', chinese = locale.startsWith('zh');
    // 同一正式 option/主题/图例实现供 Editor、PDF 和只读卡片使用，不再画一套简化图。
    const result = await renderChartImageSvg({
      spec, theme: baseChartTheme(input.theme, spec.palette), locale,
      width: Math.max(120, input.widthPx),
      messages: {
        secondaryAxis: chinese ? '右轴' : 'right axis',
        shareOfWhole: chinese ? '占整体' : 'Share of total',
        share: chinese ? '占比' : 'Share',
      },
      ...(spec.chartType === 'radar' && spec.radarScale ? {
        footnote: chinese ? `各维度共用同一量尺：0–${spec.radarScale.max}` : `All dimensions share one scale: 0–${spec.radarScale.max}`,
      } : {}),
    });
    input.signal.throwIfAborted();
    const figure = element.querySelector('.workspace-preview-chart');
    if (!figure) throw new Error('preview_chart_surface_missing');
    const image = input.document.createElement('img');
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`;
    image.width = result.width;
    image.height = result.height;
    image.alt = spec.title ?? '';
    figure.append(image);
    await waitForPreviewResource(image.decode(), input.signal);
  }
  // 图片块与其 <img> 同序：清单里没有的图片在序列化时已经失败，所以两边一一对应。
  const sources: DocumentPreviewImageSource[] = [];
  root.descendants(node => {
    if (node.type.name !== 'imageBlock') return;
    const assetId: unknown = node.attrs.assetId, id: unknown = node.attrs.id;
    const listed = input.content.images[typeof assetId === 'string' && assetId ? assetId : typeof id === 'string' ? id : ''];
    if (listed) sources.push(listed.source);
  });
  const images = Array.from(element.querySelectorAll<HTMLImageElement>('img.image-block-img'));
  if (images.length !== sources.length) throw new Error('preview_image_surface_mismatch');
  // 这里不等字体：Chromium 读取已就绪的 fonts.ready 会同步更新整份预览的样式和布局，
  // 逐块读取会让全文耗时随块数平方增长。何时等字体由调用方按是否需要逐块量高决定。
  input.signal.throwIfAborted();
  return images.map((image, index) => ({ image, source: sources[index] }));
}
