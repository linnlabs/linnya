export type DraggablePanelInitialPosition =
  | 'center'
  | 'top-right'
  | 'top-left'
  | 'bottom-right'
  | 'bottom-left';

export type DraggablePanelVariant = 'default' | 'mini';

export type DraggablePanelResizeDirection =
  | 'se'
  | 'ne'
  | 'sw'
  | 'nw'
  | 'e'
  | 'w'
  | 's'
  | 'n';

export interface DraggablePanelPositionOffset {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export type DraggablePanelPositionOffsetInput =
  | number
  | Partial<DraggablePanelPositionOffset>;

export interface DraggablePanelClassNames {
  readonly header?: string;
  readonly title?: string;
  readonly closeButton?: string;
  readonly body?: string;
}

export interface DraggablePanelProps {
  readonly visible?: boolean;
  readonly width?: string;
  readonly height?: string;
  readonly resizable?: boolean;
  readonly containerSelector?: string | null;
  readonly initialPosition?: DraggablePanelInitialPosition;
  readonly variant?: DraggablePanelVariant;
  readonly positionOffset?: DraggablePanelPositionOffsetInput;
  readonly classNames?: DraggablePanelClassNames;
}

export interface DraggablePanelBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface DraggablePanelSize {
  readonly width: number;
  readonly height: number;
}

export interface DraggablePanelPosition {
  readonly x: number;
  readonly y: number;
}

export interface DraggablePanelGeometry extends DraggablePanelPosition {
  readonly width: number;
  readonly height: number;
}

export interface DraggablePanelResizeState {
  readonly direction: DraggablePanelResizeDirection;
  readonly startX: number;
  readonly startY: number;
  readonly startWidth: number;
  readonly startHeight: number;
  readonly startPositionX: number;
  readonly startPositionY: number;
}
