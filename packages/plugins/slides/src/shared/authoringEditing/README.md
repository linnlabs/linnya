# Slides authoring editing contract

`authoringEditing` owns the cross-process contract used to identify editable objects in a generated `deck.js` document. A target is the pair `slideKey + editKey`; both keys are explicit author facts and remain independent from page order, render order, source lines, content and geometry.

`manualEdits` is a versioned, strictly parsed authoring value block. Version 2 supports complete plain-text replacement, text font size/color, Frame/Shape solid color, Shape/Image visual size, Frame subtree deletion and cumulative post-layout translation. Version 1 remains a read-only migration input and is normalized to version 2 at the codec boundary; every new source write emits version 2. Rich text, image source, table content, chart data and object creation remain outside the contract until their full-value semantics and editing UI are implemented. The contract never accepts arbitrary property paths or generic JSON patches.

`authoringEdit` is the RenderModel-side capability projection. The backend derives it from the admitted author tree before renderer text layout splits content into paragraphs or font runs. Renderer selection and property controls consume explicit capabilities plus original text/fill facts; they must not infer write safety from the visual node shape. Rich author text is projected as `rich_text` and remains movable but cannot be flattened by a manual text command. Gradient/image fills are projected as `non_solid`, so the UI may replace them with a solid color without pretending it can edit their internal stops or assets.

Flex compilation flattens a decorated Frame into one background render node plus its descendant render nodes. `_authoringAncestorRefs` preserves the author hierarchy through DirectComposeInput and DeckSpec; RenderModel exposes it as `authoringAncestorRefs`. The list may contain only same-slide, non-duplicated Frame identities in outer-to-inner order. Renderer uses this compiler-owned relation to preview a Frame translation across its complete rendered subtree. It must not derive membership from source spans, layout diagnostic paths, overlap or geometry.

Plugin migration v10 upgrades current DeckSpecs produced before this field existed. The one-time migration reads the old compiler's deterministic `layoutNodeId` hierarchy and writes `_authoringAncestorRefs`; normal RenderModel construction has no legacy dual-read path. Historical source revisions remain source-first and receive the current contract when restored or rebuilt.

Rules:

- keys use `^[A-Za-z][A-Za-z0-9_-]{0,63}$` so they are deterministic, readable and safe in source and render identities;
- `slideKey` is unique in one deck and `editKey` is unique in one slide authoring tree;
- a node with `editKey` requires its slide to have `slideKey`;
- old sources without keys continue to compile, but do not receive an authoring edit reference;
- `RenderNode.id` remains a render-tree detail; persistence and commands use `authoringRef`.
- compiled `authoringRef` also carries `targetKind` so Renderer can distinguish a decorated Frame from a Shape; this field does not participate in identity and command targets still use only the two keys;
- flattened descendants carry their editable Frame ancestors separately from their own `authoringRef`; a child remains independently editable while also participating in each ancestor Frame translation;
- a RenderNode with `authoringEdit` must also carry `authoringRef`; the strict RenderModel codec rejects malformed or contradictory capability projections;
- text replacement is accepted only when the author node still owns a string value; a rich run array cannot be overwritten through a crafted manual edit record;
- text style accepts a finite `fontSizePt` from 1 through 400 and canonical `#RRGGBB` color values; omitted style fields retain their previous manual value;
- visual size is a positive width/height pair in inches. Shape/Image size is applied after Yoga layout, so nearby Flex siblings keep their authored occupancy and do not reflow during this deliberately limited edit;
- Frame deletion is evaluated before Yoga and removes the Frame with every descendant. A deleted Frame record is exclusive and cannot also carry translation or background values;
- Shape and Frame color operations replace the author fill/background with one solid color; the limited contract does not expose gradient-stop editing;
- manual targets form a discriminated union, reject unknown fields and are unique within their slide record;
- translation is measured in inches relative to the layout result before manual translation; stored records are current values, not an append-only operation log.
