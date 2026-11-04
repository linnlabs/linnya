import { autoUpdate, computePosition, flip, offset, shift, size } from '@floating-ui/dom';

/** 挂载期间跟随真实DOM尺寸；异步封面/详情不能继续使用打开前估算的高度。 */
export function positionDocumentReferencePreview(input: {
  readonly reference: HTMLElement;
  readonly panel: HTMLElement;
  readonly report: (error: unknown) => void;
}) {
  let disposed = false,
    generation = 0;
  input.panel.style.visibility = 'hidden';
  const update = () => {
    const current = ++generation;
    void computePosition(input.reference, input.panel, {
      strategy: 'fixed',
      placement: 'bottom-start',
      middleware: [
        offset(8),
        flip({ padding: 8 }),
        shift({ padding: 8 }),
        size({
          padding: 8,
          apply({ availableWidth, availableHeight }) {
            if (disposed || current !== generation) return;
            input.panel.style.setProperty(
              '--document-reference-available-width',
              `${Math.max(0, availableWidth)}px`
            );
            input.panel.style.setProperty(
              '--document-reference-available-height',
              `${Math.max(0, availableHeight)}px`
            );
          },
        }),
      ],
    })
      .then(({ x, y }) => {
        if (disposed || current !== generation) return;
        Object.assign(input.panel.style, { left: `${x}px`, top: `${y}px`, visibility: 'visible' });
      })
      .catch(error => {
        if (!disposed && current === generation) input.report(error);
      });
  };
  // NodeView宿主也可能通过transform移动；只为打开的这一个浮层观察，关闭立即释放。
  const stop = autoUpdate(input.reference, input.panel, update, { animationFrame: true });
  return () => {
    disposed = true;
    generation += 1;
    stop();
  };
}
