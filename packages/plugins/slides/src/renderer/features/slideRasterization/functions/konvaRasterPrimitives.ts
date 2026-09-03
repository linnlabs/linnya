// 离屏栅格只装配实际使用的 Konva 原语；禁止从 `konva` 根入口拉入全部 shapes、filters 与 Transformer。
export { Stage } from 'konva/lib/Stage';
export { Layer } from 'konva/lib/Layer';
export { Group } from 'konva/lib/Group';
export { Rect } from 'konva/lib/shapes/Rect';
export { Ellipse } from 'konva/lib/shapes/Ellipse';
export { Line } from 'konva/lib/shapes/Line';
export { Path } from 'konva/lib/shapes/Path';
export { Text } from 'konva/lib/shapes/Text';
export { Image as KonvaImage } from 'konva/lib/shapes/Image';
