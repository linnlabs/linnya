import type { CanvasStatusItem } from '../features/canvasChrome';
import { canvasText } from '../features/localization';
import type { createCanvasSurface } from '../orchestration/createCanvasSurface';

type CanvasSurface = Awaited<ReturnType<typeof createCanvasSurface>>;
interface CanvasStatusInput {
  readonly surface: CanvasSurface | null;
  readonly error: string | null;
  readonly saving: boolean;
  readonly run: (action: () => Promise<unknown> | undefined) => Promise<void>;
  readonly discard: () => void;
}

/** 把画布各处的进度、提示与错误投影成一列状态，顺序即显示顺序（上到下）。 */
export function canvasStatusItems(input: CanvasStatusInput): readonly CanvasStatusItem[] {
  const { surface, error, saving, run } = input,
    items: CanvasStatusItem[] = [];
  const layout = surface?.layout;
  if (layout?.state.busy.value)
    items.push({
      id: 'layout-busy',
      text: canvasText('canvas.status.layoutBusy'),
      tone: 'neutral',
      actions: [
        {
          label: canvasText('canvas.status.cancelLayout'),
          run: () => void run(() => layout.cancel()),
        },
      ],
    });
  else if (layout?.state.diagnostics.value.length)
    items.push({
      id: 'layout-diagnostics',
      text: layout.state.diagnostics.value
        .map(item => item.message)
        .join(canvasText('canvas.list.separator')),
      tone: 'neutral',
    });
  if (layout?.state.treeKeyboard.value)
    items.push({
      id: 'tree-keyboard',
      text: canvasText('canvas.status.treeKeyboard'),
      tone: 'neutral',
      actions: [
        {
          label: canvasText('canvas.status.close'),
          run: () => layout.state.setTreeKeyboard(false),
        },
      ],
    });
  const integrity = surface?.integrityNotice.value,
    render = surface?.renderNotice.value;
  if (integrity) items.push({ id: 'integrity', text: integrity, tone: 'neutral' });
  if (render) items.push({ id: 'render', text: render, tone: 'neutral' });
  const delivery = surface?.session.deliveryNotice.value;
  if (error)
    items.push({
      id: 'error',
      text: error,
      tone: 'error',
      actions: surface?.hasDraft.value
        ? [
            {
              label: canvasText('canvas.status.useSaved'),
              disabled: saving || Boolean(delivery),
              run: input.discard,
            },
          ]
        : [],
    });
  if (delivery && surface)
    items.push({
      id: 'delivery',
      text: delivery,
      tone: 'error',
      actions: [
        {
          label: canvasText('canvas.status.retryConfirm'),
          run: () => void run(() => surface.session.retryDelivery()),
        },
      ],
    });
  else if (!surface && !error)
    items.push({ id: 'opening', text: canvasText('canvas.status.opening'), tone: 'neutral' });

  return items;
}
