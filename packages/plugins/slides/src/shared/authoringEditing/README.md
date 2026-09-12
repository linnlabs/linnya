# Slides authoring editing contract

`authoringEditing` owns the cross-process contract used to identify editable objects in a generated `deck.js` document. A target is the pair `slideKey + editKey`; both keys are explicit author facts and remain independent from page order, render order, source lines, content and geometry.

The current slice only establishes and projects identity. Manual values and write commands must extend this package with narrow discriminated contracts; they must not accept arbitrary property paths or generic JSON patches.

Rules:

- keys use `^[A-Za-z][A-Za-z0-9_-]{0,63}$` so they are deterministic, readable and safe in source and render identities;
- `slideKey` is unique in one deck and `editKey` is unique in one slide authoring tree;
- a node with `editKey` requires its slide to have `slideKey`;
- old sources without keys continue to compile, but do not receive an authoring edit reference;
- `RenderNode.id` remains a render-tree detail; persistence and commands use `authoringRef`.

