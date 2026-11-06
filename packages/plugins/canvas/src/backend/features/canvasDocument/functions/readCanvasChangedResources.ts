import type { CanvasElement } from '../../../../shared';
import type { CanvasElementChange } from '../../canvasCommit';
import { collectCanvasReferences } from './collectCanvasReferences';
import { collectCanvasAssetIds } from './collectCanvasAssets';

/** 移动/染色不触碰关系与资产；同卡在一批里多次修改只比较原始与最终资源身份。 */
export function readCanvasChangedResources(changes: readonly CanvasElementChange[]) {
  const before = new Map<string, CanvasElement | null>(), after = new Map<string, CanvasElement | null>();
  for (const change of changes) {
    if (change.before && change.after && !change.fields.some(field => field === 'data' || field === '$entity')) continue;
    if (!before.has(change.id)) before.set(change.id, change.before);
    after.set(change.id, change.after);
  }
  const original = [...before.values()].filter((element): element is CanvasElement => element !== null);
  const final = [...after.values()].filter((element): element is CanvasElement => element !== null);
  const originalReferences = collectCanvasReferences(original), finalReferences = collectCanvasReferences(final);
  const referenceKeys = new Set(originalReferences.map(reference => JSON.stringify(reference)));
  const finalKeys = new Set(finalReferences.map(reference => JSON.stringify(reference)));
  const originalAssets = new Set(collectCanvasAssetIds(original));
  return {
    referencesChanged: originalReferences.length !== finalReferences.length || finalKeys.size !== finalReferences.length || finalReferences.some(reference => !referenceKeys.has(JSON.stringify(reference))),
    addedAssetIds: collectCanvasAssetIds(final).filter(id => !originalAssets.has(id)),
  };
}
