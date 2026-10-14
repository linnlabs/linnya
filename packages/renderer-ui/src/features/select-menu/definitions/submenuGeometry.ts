export interface SubmenuRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  height: number;
  width: number;
}

export interface SubmenuViewport {
  width: number;
  height: number;
}

export interface SubmenuGeometryInput {
  parent: SubmenuRect;
  menu: SubmenuRect;
  panel: Pick<SubmenuRect, 'width' | 'height'>;
  viewport: SubmenuViewport;
}
