import type {
  DraggablePanelBounds,
  DraggablePanelGeometry,
  DraggablePanelInitialPosition,
  DraggablePanelPosition,
  DraggablePanelPositionOffset,
  DraggablePanelPositionOffsetInput,
  DraggablePanelResizeState,
  DraggablePanelSize,
} from '../definitions/draggablePanel';

const DEFAULT_POSITION_OFFSET = 16;

export function normalizeDraggablePanelPositionOffset(
  offset: DraggablePanelPositionOffsetInput,
): DraggablePanelPositionOffset {
  if (typeof offset === 'number') {
    return { top: offset, right: offset, bottom: offset, left: offset };
  }
  return {
    top: offset.top ?? DEFAULT_POSITION_OFFSET,
    right: offset.right ?? DEFAULT_POSITION_OFFSET,
    bottom: offset.bottom ?? DEFAULT_POSITION_OFFSET,
    left: offset.left ?? DEFAULT_POSITION_OFFSET,
  };
}

export function parseDraggablePanelSize(size: string, fallback: number): number {
  const parsed = Number.parseInt(size);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function resolveDraggablePanelPosition(
  bounds: DraggablePanelBounds,
  size: DraggablePanelSize,
  initialPosition: DraggablePanelInitialPosition,
  offset: DraggablePanelPositionOffset,
): DraggablePanelPosition {
  switch (initialPosition) {
    case 'top-right':
      return {
        x: bounds.left + bounds.width - size.width - offset.right,
        y: bounds.top + offset.top,
      };
    case 'top-left':
      return { x: bounds.left + offset.left, y: bounds.top + offset.top };
    case 'bottom-right':
      return {
        x: bounds.left + bounds.width - size.width - offset.right,
        y: bounds.top + bounds.height - size.height - offset.bottom,
      };
    case 'bottom-left':
      return {
        x: bounds.left + offset.left,
        y: bounds.top + bounds.height - size.height - offset.bottom,
      };
    case 'center':
      return {
        x: bounds.left + Math.max(0, Math.floor((bounds.width - size.width) / 2)),
        y: bounds.top + Math.max(0, Math.floor((bounds.height - size.height) / 2)),
      };
  }
}

export function constrainDraggablePanelGeometry(
  geometry: DraggablePanelGeometry,
  bounds: DraggablePanelBounds,
  minimumSize: DraggablePanelSize,
): DraggablePanelGeometry {
  const width = clamp(geometry.width, minimumSize.width, bounds.width);
  const height = clamp(geometry.height, minimumSize.height, bounds.height);
  const maximumX = bounds.left + bounds.width - width;
  const maximumY = bounds.top + bounds.height - height;

  return {
    x: clamp(geometry.x, bounds.left, maximumX),
    y: clamp(geometry.y, bounds.top, maximumY),
    width,
    height,
  };
}

export function resizeDraggablePanelGeometry(
  resizeState: DraggablePanelResizeState,
  pointer: DraggablePanelPosition,
  bounds: DraggablePanelBounds,
  minimumSize: DraggablePanelSize,
): DraggablePanelGeometry {
  const deltaX = pointer.x - resizeState.startX;
  const deltaY = pointer.y - resizeState.startY;
  let width = resizeState.startWidth;
  let height = resizeState.startHeight;
  let x = resizeState.startPositionX;
  let y = resizeState.startPositionY;

  if (resizeState.direction.includes('e')) {
    width = resizeState.startWidth + deltaX;
  } else if (resizeState.direction.includes('w')) {
    width = resizeState.startWidth - deltaX;
    x = resizeState.startPositionX + deltaX;
  }

  if (resizeState.direction.includes('s')) {
    height = resizeState.startHeight + deltaY;
  } else if (resizeState.direction.includes('n')) {
    height = resizeState.startHeight - deltaY;
    y = resizeState.startPositionY + deltaY;
  }

  return constrainDraggablePanelGeometry({ x, y, width, height }, bounds, minimumSize);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
