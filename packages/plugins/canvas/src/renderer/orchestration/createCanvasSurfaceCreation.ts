import {
  type CanvasArrangeRequest,
  type CanvasEndpoint,
  type CanvasPoint,
} from '@plugin/canvas/shared';
import { requireWritableCanvas } from '../features/canvasDocument';
import { createCanvasTreeCreation } from './createCanvasTreeCreation';

import type { CanvasSurfaceCreationOptions } from './definitions/canvasSurfaceComposition';

/** 新建文本/树节点共享切换保存、可写校验和初始位置流程。 */
export function createCanvasSurfaceCreation({
  options,
  base,
  rendering,
  drafts,
  opening,
  connections,
  readViewport,
}: CanvasSurfaceCreationOptions) {
  const { session, layout, selection } = base;
  const { kernel } = rendering;
  const { creation, finish, setDirty } = drafts;
  async function createText(
    point?: CanvasPoint,
    text = '',
    from: CanvasEndpoint | null = null,
    arrangement: CanvasArrangeRequest['options'] | null = null
  ) {
    opening.cancel();
    requireWritableCanvas(session.state.snapshot.value);
    if (!(await finish()) || !(await connections.saveLabel())) return;
    const target =
      point ??
      kernel.screenToWorld({
        x: options.host.clientWidth / 2 - 140,
        y: options.host.clientHeight / 2 - 90,
      });
    selection.select([]);
    kernel.setSelection([]);
    await connections.select(null);
    const draft = creation.begin(target, from, text, arrangement);
    setDirty();
    return draft;
  }
  const createTree = createCanvasTreeCreation({
    finish,
    plan: kind => layout?.planTree(selection.ids.value, kind) ?? null,
    create: plan => createText(plan.point, '', plan.from, plan.options),
    reveal: rectangle => readViewport().revealRectangle(rectangle),
  });
  return { createText, createTree };
}
