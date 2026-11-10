import type { CanvasElement } from '../../../../shared';
import type { CanvasUpdateFieldUnit } from '../definitions/canvasUpdateFields';

const dimensions = ['data', 'width', 'height'];
const geometry = ['x', 'y', 'width', 'height'];
function hasImageFrameChange(
  before: CanvasElement,
  after: CanvasElement,
  fields: ReadonlySet<string>
): boolean {
  return (
    before.type === 'image' &&
    after.type === 'image' &&
    fields.has('data') &&
    geometry.some(field => fields.has(field)) &&
    (before.data.assetId !== after.data.assetId ||
      JSON.stringify(before.data.crop) !== JSON.stringify(after.data.crop))
  );
}
function hasAutomaticText(before: CanvasElement, after: CanvasElement): boolean {
  return (
    before.type === 'text' &&
    after.type === 'text' &&
    (before.data.heightMode === 'auto' || after.data.heightMode === 'auto')
  );
}
/** 普通更新和历史逆转共用同一字段依赖定义，版本/来源的冲突判断由各调用方完成。 */
export function readCanvasUpdateFieldUnits(input: {
  readonly before: CanvasElement;
  readonly after: CanvasElement;
  readonly fields: readonly string[];
  readonly layout?: boolean;
}): CanvasUpdateFieldUnit[] {
  const { before, after } = input;
  const remaining = new Set(input.fields),
    units: CanvasUpdateFieldUnit[] = [];
  const take = (
    fields: readonly string[],
    dependencies: readonly string[],
    dependencyReason: CanvasUpdateFieldUnit['dependencyReason']
  ) => {
    const present = fields.filter(field => remaining.delete(field));
    if (present.length) units.push({ fields: present, dependencies, dependencyReason });
  };
  if (hasImageFrameChange(before, after, remaining))
    take(['data', ...geometry], ['data', ...geometry], 'stale_geometry');
  else if (hasAutomaticText(before, after)) take(dimensions, dimensions, 'stale_measurement');
  if (remaining.has('width') && remaining.has('height'))
    take(['width', 'height'], [], 'stale_geometry');
  take(['x', 'y'], input.layout ? ['width', 'height'] : [], 'stale_layout_size');
  if (remaining.has('from') && remaining.has('to')) take(['from', 'to'], [], 'stale_geometry');
  for (const field of remaining)
    units.push({ fields: [field], dependencies: [], dependencyReason: 'stale_geometry' });
  return units;
}
