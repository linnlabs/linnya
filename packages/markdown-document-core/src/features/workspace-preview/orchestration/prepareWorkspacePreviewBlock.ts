import { MarkdownChartSpecSchema } from '@app/schemas';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { WorkspaceMarkdownPreviewInput } from '../definitions/workspacePreview';

/** 字体/图片就绪后再测量；取消不等待屏下资源，也不会留下挂在document上的测量节点。 */
export async function waitForPreviewResource<T>(promise: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Preview cancelled', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function prepareWorkspacePreviewBlock(
  root: ProseMirrorNode, element: HTMLElement, input: WorkspaceMarkdownPreviewInput,
): Promise<void> {
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
  }
  for (const image of Array.from(element.querySelectorAll('img'))) {
    await waitForPreviewResource(image.decode(), input.signal);
  }
  if (input.document.fonts) await waitForPreviewResource(input.document.fonts.ready, input.signal);
  input.signal.throwIfAborted();
}
