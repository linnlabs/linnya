# Slides element properties

`elementProperties` owns the limited property controls shown for one selected authoring target. It receives an immutable `ManualEditableTarget`, derives available controls only from the compiler-projected capabilities, and emits a typed manual-edit operation. It does not own selection, persistence, compilation or RenderModel state.

Supported controls:

- plain text: font size from 1 through 400 points and `#RRGGBB` text color;
- Frame/Shape: replace the existing background/fill with one solid color;
- Shape: set visual width and height independently in inches; Image: changing either dimension preserves the committed display ratio;
- Frame: delete the Frame and every descendant.

The panel intentionally has no create, group, reparent, gradient editor, image crop/source editor, rich-text run editor or free-form property path. `elementPropertyOperations.ts` validates the same user-value ranges as the shared command codec and checks both target kind and projected capability before creating an operation. `SlideStage` remains the app-level assembly point and passes accepted operations to `manualEditing`, which owns optimistic presentation and submission lifecycle.

The color palette reuses the stable Renderer UI color-picker contract. The feature keeps its own Slides-specific palette and localization catalog because those values belong to this interaction rather than the cross-domain component library. The Vue component contains only field state and event wiring; operation rules and panel geometry live in pure functions.

While a command is pending, controls stop emitting additional operations. The accepted value is already projected by `manualEditing`: text style, fill, size and Frame deletion appear in the current Canvas frame, then stay until the committed RenderModel revision is installed. A backend failure removes that projection and restores the committed pixels.

Tests in `functions/elementPropertyOperations.test.ts` cover target/capability boundaries, value validation and destructive Frame deletion semantics. Compiler, source-write, IPC and revision lifecycle coverage remains with their owning backend/shared features.
