# Slides authoring editing contract

`authoringEditing` owns the cross-process contract used to identify editable objects in a generated `deck.js` document. A target is the pair `slideKey + editKey`; both keys are explicit author facts and remain independent from page order, render order, source lines, content and geometry.

`manualEdits` is a versioned, strictly parsed authoring value block. It currently supports complete plain-text replacement and cumulative post-layout translation. Frame and atomic visual nodes only accept translation. Rich text, image source, table content and chart data remain outside the contract until their full-value semantics and editing UI are implemented. It never accepts arbitrary property paths or generic JSON patches.

Rules:

- keys use `^[A-Za-z][A-Za-z0-9_-]{0,63}$` so they are deterministic, readable and safe in source and render identities;
- `slideKey` is unique in one deck and `editKey` is unique in one slide authoring tree;
- a node with `editKey` requires its slide to have `slideKey`;
- old sources without keys continue to compile, but do not receive an authoring edit reference;
- `RenderNode.id` remains a render-tree detail; persistence and commands use `authoringRef`.
- compiled `authoringRef` also carries `targetKind` so Renderer can distinguish a decorated Frame from a Shape; this field does not participate in identity and command targets still use only the two keys;
- manual targets form a discriminated union, reject unknown fields and are unique within their slide record;
- translation is measured in inches relative to the layout result before manual translation; stored records are current values, not an append-only operation log.
