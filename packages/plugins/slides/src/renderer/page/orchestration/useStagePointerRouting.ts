import type { StagePointerRouting } from '../definitions/stagePointerRouting';

export function useStagePointerRouting(options: StagePointerRouting) {
/**
 * 一套选择：作者对象走手动编辑交互；指针下没有作者对象、但有带源码定位的元素时，
 * 这次点击交给 AI 选择。两种选区互斥，后续指针事件跟随本次按下的归属。
 */
let pointerOwner: 'manual' | 'source' = 'manual';

function handleStageBlankPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  // 留白与页内背景共用交接语义；只监听容器自身，避免工具条和拖拽事件误清选区。
  pointerOwner = 'manual';
  options.clearSourceSelection();
  options.handleManualPointerDown(event, true);
  options.focusCanvas();
}

function handleStagePointerDown(event: PointerEvent): void {
  if (!options.hasManualTargetAt(event) && options.hasSourceTargetAt(event)) {
    pointerOwner = 'source';
    options.clearManualSelection();
    options.handleSourcePointerDown(event);
  } else {
    pointerOwner = 'manual';
    options.clearSourceSelection();
    options.handleManualPointerDown(event);
  }
  options.focusCanvas();
}

function handleStagePointerMove(event: PointerEvent): void {
  // 两个交互都只认自己按下的 pointer；没有手势时各自只更新悬停。
  options.handleManualPointerMove(event);
  options.handleSourcePointerMove(event);
}

function handleStagePointerUp(event: PointerEvent): void {
  if (pointerOwner === 'source') options.handleSourcePointerUp(event);
  else options.handleManualPointerUp(event);
}

function handleStagePointerCancel(event: PointerEvent): void {
  if (pointerOwner === 'source') options.handleSourcePointerCancel(event);
  else options.handleManualPointerCancel(event);
}

function handleStagePointerLeave(): void {
  options.handleManualPointerLeave();
  options.handleSourcePointerLeave();
}

function handleStageDoubleClick(event: MouseEvent): void {
  options.handleManualDoubleClick(event);
}

  return { handleStageBlankPointerDown, handleStagePointerDown, handleStagePointerMove, handleStagePointerUp, handleStagePointerCancel, handleStagePointerLeave, handleStageDoubleClick };
}
