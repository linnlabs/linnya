# Slides element properties

`elementProperties` owns the limited property controls shown for one selected authoring target. It receives an immutable `ManualEditableTarget`, derives available controls only from the compiler-projected capabilities, and emits a typed manual-edit operation. A target with only `translate` produces no panel, and the panel does not repeat the target's author key as a heading. It does not own selection, persistence, compilation or RenderModel state.

Supported controls:

- plain text: font size from 1 through 400 points and `#RRGGBB` text color;
- Frame/Shape: replace the existing background/fill with one solid color;
- Shape: set visual width and height independently in inches; Image: changing either dimension preserves the current effective display ratio. Number changes submit on Enter/blur without a separate Apply-size step;
- Frame: delete the Frame and every descendant.

The explicit destructive button remains Frame-only because its subtree scope needs a visible control. The sibling `editingInteraction` feature routes `Backspace` / `Delete` to manualEditing commands for every selected author target; that keyboard capability does not create an otherwise empty property panel.

The panel intentionally has no create, group, reparent, gradient editor, image crop/source editor, rich-text run editor or free-form property path. `elementPropertyOperations.ts` validates the same user-value ranges as the shared command codec and checks both target kind and projected capability before creating an operation. `SlideStage` connects the panel to `editingInteraction`, which passes accepted operations to `manualEditing`, which owns optimistic presentation and submission lifecycle.

The color palette reuses the stable Renderer UI color-picker contract, shared number/text inputs and action buttons. Preset selection compares canonical HEX values; a solid color outside the palette selects the custom-color row with a swatch, HEX value and checkmark. Non-solid fill selects neither. The inline custom editor offers an HSV plane, keyboard-accessible range controls and six-digit HEX input. Its draft stays local until Apply/Enter; Cancel/Escape emits no operation. Choosing a preset submits directly. The feature keeps its Slides-specific palette, HSV conversion and localization because these belong to this interaction rather than the cross-domain component library.

The three HSV channels use Renderer UI `CustomSlider` in compact density, shared with the deck zoom control. Slides receives numeric updates and owns only HSV normalization and draft state; it does not style native tracks/thumbs or maintain DOM progress. This consumer requires Renderer UI `^2.3.0` in both peer and plugin compatibility manifests. The shared package owns the slider CSS; the plugin continues to load only its own stylesheets.

`projectElementPropertyTarget` projects the same active/queued visual operations used by Canvas into the panel values. This includes pending font size, color and size; it never persists another copy of those values. Each number field synchronizes only when its own effective value or target identity changes, so unrelated color updates do not erase an in-progress size input. The Vue components keep transient field state and event wiring; value validation, color conversion and panel geometry live in pure functions.

Panel and custom-color CSS load through the plugin Renderer stylesheet contribution. Styles target only owned elements: a broad descendant `button` selector would override shared color cells and destroy their actual colors/selection feedback. Chrome uses Renderer UI semantic tokens; only actual slide colors and the color-plane coordinates own literal content colors. Shared UI internal selectors must not be overridden.

While a command or its target visual frame is pending, controls remain usable and emit typed intents into `manualEditing`'s serialized queue. Text style, fill, size and Frame deletion are projected immediately from the active and queued values, then stay until each committed RenderModel revision is installed. Adjacent queued absolute changes for one target are coalesced to avoid redundant full compilation. A backend failure removes the active and queued projections and restores the committed pixels.

Tests in `functions/elementPropertyOperations.test.ts` cover target/capability boundaries, value validation and destructive Frame deletion semantics. `functions/hasElementPropertyControls.test.ts` verifies that move-only targets do not create empty UI. Compiler, source-write, IPC and revision lifecycle coverage remains with their owning backend/shared features.

`projectElementPropertyTarget.test.ts` covers composed pending/queued text values and rollback; `customColor.test.ts` covers HEX/HSV round-trips and captured plane bounds. The `smoke:preview-transitions` browser fixture mounts this production panel alongside Canvas and resize handles, verifies preset/custom selection, invalid HEX, Apply/Cancel, independent numeric drafts and rollback, and captures light/dark/moon-blue themes after transitions settle. It exercises UI-to-intent/preview behavior; it does not replace full App Server save/reopen/export acceptance.
