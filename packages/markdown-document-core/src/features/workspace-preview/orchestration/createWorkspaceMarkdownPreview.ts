import { assertMarkdownDocument } from '../../../functions/assertMarkdownDocument';
import { workspaceMarkdownSchemaLite } from '../../workspace-schema';
import type { WorkspaceMarkdownPreviewInput, WorkspaceMarkdownPreviewSurface } from '../definitions/workspacePreview';
import { createWorkspacePreviewSerializer } from '../functions/createWorkspacePreviewSerializer';
import { workspaceListNumbers } from '../functions/workspaceListNumbers';
import { prepareWorkspacePreviewBlock, waitForPreviewResource, type PendingWorkspacePreviewImage } from './prepareWorkspacePreviewBlock';
import { fitStaticWorkspaceTable, WORKSPACE_TABLE_CLASS } from '../../workspace-table';

/**
 * 首屏与详情使用同一渲染；按真实块高逐步准备，到相交块停止，绝不先渲染全部图表再裁切。
 * 临时测量节点只存在于本次调用，成功后移交结果，失败/取消立即释放。
 */
export async function createWorkspaceMarkdownPreview(input: WorkspaceMarkdownPreviewInput): Promise<WorkspaceMarkdownPreviewSurface> {
  input.signal.throwIfAborted();
  const json = input.content.document;
  // Pending 可以删除最后一个块；此空投影不回写、不放宽正式保存的 rootBlock+ 合同。
  const emptyProjection = json !== null && typeof json === 'object' && !Array.isArray(json)
    && json.type === 'doc' && Array.isArray(json.content) && json.content.length === 0
    && Object.keys(json).every(key => key === 'type' || key === 'content');
  if (!emptyProjection) assertMarkdownDocument(json, workspaceMarkdownSchemaLite);
  const node = emptyProjection ? workspaceMarkdownSchemaLite.topNodeType.create() : workspaceMarkdownSchemaLite.nodeFromJSON(json);
  const element = input.document.createElement('div');
  element.className = 'workspace-markdown-preview';
  element.setAttribute('data-linnya-ui-theme', input.theme);
  element.style.width = `${input.widthPx}px`;
  // 正文只读；链接保留外观和可复制目标，实际打开文档由统一预览外壳负责。
  element.addEventListener('click', event => event.preventDefault());
  const stage = input.document.createElement('div');
  stage.setAttribute('aria-hidden', 'true');
  stage.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;contain:layout style;';
  stage.append(element);
  input.document.body.append(stage);
  let disposed = false;
  // 图片地址的寿命跟随正文：交付后才到的图片（屏下懒加载）也在 dispose 时取消并归还。
  const lifetime = new AbortController();
  const releases: (() => void)[] = [];
  let observer: IntersectionObserver | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    lifetime.abort();
    observer?.disconnect();
    for (const release of releases.splice(0)) release();
    element.replaceChildren();
    element.remove();
    stage.remove();
    input.signal.removeEventListener('abort', dispose);
  };
  input.signal.addEventListener('abort', dispose, { once: true });
  // 每读一次已就绪的 fonts.ready，Chromium 都会同步更新整份预览的样式和布局
  // （third_party/blink/renderer/core/css/font_face_set_document.cc 的 ready()），所以读取次数必须有界。
  const fontsReady = async () => {
    if (input.document.fonts) await waitForPreviewResource(input.document.fonts.ready, input.signal);
  };
  // 字体就绪后按本次宽度给表格定级；与编辑器同一套退让规则。定级只看表格自身与外层滚动容器，和后续块无关。
  const fitTables = (scope: HTMLElement) => {
    for (const table of Array.from(scope.querySelectorAll<HTMLElement>(`table.${WORKSPACE_TABLE_CLASS}`))) {
      const scroller = table.parentElement;
      if (scroller) fitStaticWorkspaceTable(table, scroller);
    }
  };
  const loadImage = async ({ image, source }: PendingWorkspacePreviewImage) => {
    if (!input.loadImage) throw new Error('preview_image_loader_missing');
    // 位置已按清单尺寸占好，排出的宽高就是最终显示尺寸，加载方据此选档。
    const handle = await input.loadImage({ source, widthPx: image.offsetWidth, heightPx: image.offsetHeight, signal: lifetime.signal });
    if (disposed) {
      handle.release();
      throw lifetime.signal.reason;
    }
    releases.push(handle.release);
    image.src = handle.url;
    await waitForPreviewResource(image.decode(), lifetime.signal);
  };
  try {
    const serializer = createWorkspacePreviewSerializer({ ...input, node, locale: input.locale ?? 'zh-CN' });
    const deferred: PendingWorkspacePreviewImage[] = [];
    const numbers = new Map(workspaceListNumbers(node).map(item => [item.rootPosition, item]));
    let position = 0;
    for (let index = 0; index < node.childCount; index++) {
      input.signal.throwIfAborted();
      const block = node.child(index);
      const rendered = serializer.serializeNode(block, { document: input.document });
      if (rendered.nodeType !== 1) throw new Error('preview_root_block_not_element');
      // serializeNode 已由本模块的根节点工厂保证 HTMLElement，跨 realm 用 ownerDocument 的类型检查。
      const blockElement = input.document.createElement('div');
      blockElement.className = 'workspace-preview-block';
      blockElement.append(rendered);
      const numbering = numbers.get(position);
      if (numbering) {
        const list = blockElement.querySelector('.list-item-block');
        list?.setAttribute('data-ordered-index', String(numbering.value));
      }
      element.append(blockElement);
      const images = await prepareWorkspacePreviewBlock(block, blockElement, input);
      position += block.nodeSize;
      // 全文不需要逐块量高：字体、表格定级与图片留到循环结束后统一处理（见下）。
      if (input.maxHeight === undefined) {
        deferred.push(...images);
        continue;
      }
      // 首屏只排到相交块为止，排出来的图片都在首屏里：等它们到了再交付，屏下的图片一张也不取。
      await Promise.all(images.map(loadImage));
      // 首屏必须逐块量真实高度才能停在相交块，所以逐块等字体；块数受 maxHeight 限制，不会随文档长度增长。
      await fontsReady();
      fitTables(blockElement);
      if (element.getBoundingClientRect().height >= input.maxHeight) {
        element.style.maxHeight = `${input.maxHeight}px`;
        element.style.overflow = 'hidden';
        element.setAttribute('data-preview-clipped', String(index < node.childCount - 1 || element.scrollHeight > input.maxHeight));
        break;
      }
    }
    await fontsReady();
    if (input.maxHeight === undefined) fitTables(element);
    if (deferred.length > 0) {
      const below = input.lazyImagesBelowPx;
      // 图片都已占位，这里量一次位置即可分出“一交付就看得见”的和屏下的。
      const top = element.getBoundingClientRect().top;
      const waiting = new Map<Element, PendingWorkspacePreviewImage>();
      const eager: PendingWorkspacePreviewImage[] = [];
      for (const item of deferred) {
        if (below === undefined || item.image.getBoundingClientRect().top - top < below) eager.push(item);
        else waiting.set(item.image, item);
      }
      await Promise.all(eager.map(loadImage));
      const view = input.document.defaultView;
      if (waiting.size > 0 && view) {
        // 预览在自己的滚动容器里滚动：rootMargin 只放大窗口，不提前量滚动容器内的图片，
        // 所以用 scrollMargin 让图片在滚到之前一屏左右就开始取（Chromium 120 起支持）。
        const options: IntersectionObserverInit & { readonly scrollMargin: string } = { rootMargin: '400px', scrollMargin: '400px' };
        const watching = new view.IntersectionObserver(entries => {
          for (const entry of entries) {
            const item = waiting.get(entry.target);
            if (!entry.isIntersecting || !item) continue;
            waiting.delete(entry.target);
            watching.unobserve(entry.target);
            // 屏下图片取不到不影响已交付的正文：位置保留，标记后由样式呈现缺图。
            loadImage(item).catch(() => {
              if (!disposed) item.image.setAttribute('data-preview-image', 'failed');
            });
          }
        }, options);
        observer = watching;
        for (const image of waiting.keys()) watching.observe(image);
      }
    }
    input.signal.throwIfAborted();
    element.remove();
    stage.remove();
    return { element, dispose };
  } catch (failure) {
    dispose();
    throw failure;
  }
}
