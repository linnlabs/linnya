export interface ShapeTextLayout {
  fontSize: number;
  align: 'left' | 'center' | 'right';
  valign: 'top' | 'middle' | 'bottom';
  marginPoints: [number, number, number, number];
  paddingInches: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}
