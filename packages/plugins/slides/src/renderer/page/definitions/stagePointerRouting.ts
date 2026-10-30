export interface StagePointerRouting {
  hasManualTargetAt(event: PointerEvent): boolean;
  hasSourceTargetAt(event: PointerEvent): boolean;
  handleManualPointerDown(event: PointerEvent, blank?: boolean): void;
  handleSourcePointerDown(event: PointerEvent): void;
  handleManualPointerMove(event: PointerEvent): void;
  handleSourcePointerMove(event: PointerEvent): void;
  handleManualPointerUp(event: PointerEvent): void;
  handleSourcePointerUp(event: PointerEvent): void;
  handleManualPointerCancel(event: PointerEvent): void;
  handleSourcePointerCancel(event: PointerEvent): void;
  handleManualPointerLeave(): void;
  handleSourcePointerLeave(): void;
  handleManualDoubleClick(event: MouseEvent): void;
  clearManualSelection(): void;
  clearSourceSelection(): void;
  focusCanvas(): void;
}
