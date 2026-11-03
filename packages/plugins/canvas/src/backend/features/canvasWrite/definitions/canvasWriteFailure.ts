export class CanvasWriteFailure extends Error {
  constructor(readonly code: 'wrong_element_type' | 'element_missing', message: string, readonly operation?: number, readonly field?: string) {
    super(message); this.name = 'CanvasWriteFailure';
  }
}
