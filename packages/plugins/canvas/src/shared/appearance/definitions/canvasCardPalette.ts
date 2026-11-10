export interface CanvasCardPalette {
  readonly paper: number;
  readonly title: number;
  readonly body: number;
  readonly muted: number;
}
export type CanvasCardCssPalette = { readonly [Role in keyof CanvasCardPalette]: string };
