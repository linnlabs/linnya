# RenderNode selection geometry

`renderNodeSelection` owns renderer-local traversal and world-coordinate geometry for visible RenderModel nodes. It understands nested group transforms, rotation, z-order and rectangular hit testing, but it does not decide whether a node is source-backed, manually editable or eligible for another workflow.

Consumers provide a narrow type-guard predicate. The feature returns the matching node together with its world polygon, bounds and z-path. `sourceSelection` maps source-backed results to source spans and summaries; `manualEditing` maps author-capability results to manual targets. This keeps generic render geometry independent from either business workflow and prevents manual editing from depending on `sourceSpan`.

The module contains only pure TypeScript:

```text
definitions/  point, rect and generic node geometry
functions/    matrix math, traversal, collection and topmost hit testing
```

Coordinate values use the RenderModel logical inch space. Pixel conversion and DOM/Konva event adaptation remain with the consuming interaction feature.

Tests are exercised both through `sourceSelection/functions/sourceSelection.test.ts` for nested groups, rotation, visibility and z-order, and through `manualEditing/functions/manualEditableTargets.test.ts` for author targets without source spans.
