# Slides limited manual editing

`manualEditing` owns the Renderer side of limited editing for generated `deck.js` presentations. It selects only compiler-projected author objects, previews a drag without mutating RenderModel, and submits a strict command against the exact revision/source snapshot. The backend remains the only writer. It may use the proven post-layout translation projection for a unique top-level atomic object; all other edits use the full author compiler. Both paths commit the semantic revision without waiting for PPTX assembly and publish the same revision contract.

## Current interaction

- The toolbar edit button is available only for a ready generated document whose visible RenderModel version equals the build-state revision and whose current slide contains at least one editable author object.
- Clicking an object resolves one author hierarchy path from the compiler-projected `authoringAncestorRefs`. The first click selects the outermost visible Frame; another click at the same child location enters the next layer. Once a child is selected, one click on a sibling selects that sibling directly; a click into a different nested branch stops at the first target after the common ancestor. Only a real multi-level path shows a compact breadcrumb, centered directly on the selected bounds' top edge; it lets the user return to any ancestor without creating a detached selection popup. Pointer-down locks the current layer as the gesture owner, so dragging over a child moves the selected Frame rather than switching targets mid-gesture. Releasing promotes the delta to a local pending translation before sending one `translate_by` operation in inches. The pending visual is removed only after the committed RenderModel revision and its current-page image/chart resources form the displayed frame, or rolled back on failure.
- Double-clicking a text object whose backend `authoringEdit` projection declares `set_text_content` starts the sibling [`textEditing`](../textEditing/README.md) feature. It overlays a browser textarea on the exact committed text geometry and hides only that RenderNode's Canvas text for the duration of the session. Blur or `Ctrl/Cmd+Enter` replaces the complete author string and runs the normal backend text measurement and layout pipeline. When blur was caused by clicking another object, that target is retained as a deferred selection and applied after the edited revision is presented; a failed save rejects the deferred switch and retains the editor and draft. IME composition cannot accidentally trigger submission. Multiline strings and strings split into Latin/East Asian render runs remain editable because their author value is still one string.
- Selecting an object exposes the sibling [`elementProperties`](../elementProperties/README.md) feature only when the compiler projects at least one property action: plain-text font size/color, Frame/Shape solid color, Shape/Image visual width/height, or deletion of a Frame with every descendant. Move-only objects do not create an empty panel, and the panel does not repeat an author key as a floating title.
- Rich author runs and inline formula runs remain text-read-only because replacing them with one string would destroy run semantics. They may still move.
- Image and Shape author objects may resize when projected as safe; Table, Chart, SVG Graphic and formula author objects currently only move. Their content/data/source editors remain later independent feature slices.
- A decorated Flex Frame is selected through its background and moves as one author object. The compiler projects every flattened descendant's `authoringAncestorRefs`; the target mapper turns that relation into the exact RenderNode roots that share one optimistic translation. Child text and visual objects keep their own author identity, so clicking them can still select and edit the child independently. Nested rendered Groups contribute only their outer affected root, avoiding a double transform.

The existing source-selection/AI-edit mode and manual-edit mode are mutually exclusive. Both consume compiler facts from the same RenderModel and share the same pointer-to-slide coordinate function. Source selection may admit any node with source ownership, while manual editing additionally requires an explicit author identity and capability; their transient selections and write workflows remain in separate feature stores.

## Layers

```text
definitions/
  manualEditingTypes + localized message catalog
functions/
  author-capability target/path projection, hit testing, availability, command creation, result messages
orchestration/
  pointer selection/drag + submit/refresh workflow
store/
  mode, selected target, gesture/queued preview state, synchronous intent queue state
ui/
  localization adapter
```

The store never calls IPC and never contains geometry or conflict rules. Generic world-coordinate traversal belongs to the sibling `renderNodeSelection` feature; manual editing contributes only its author-capability predicate and target mapping. `SlidesView` is the app-level assembly point: it drains typed edit intents one at a time, supplies the current document snapshot to `submitManualEdit`, invokes `slidesApi`, and requests the committed revision. The next intent starts only after the prior committed revision is both the current build version and the installed RenderModel version. `SlideStage` records presentation only when `renderVisualResources` has atomically installed the target page frame. Active and queued previews are projected together, so the canvas does not jump back while compilation catches up. Adjacent queued edits of the same kind and author target are coalesced; for example, a font-size change followed quickly by a color change becomes one `set_text_style` compile.

## Conflict and failure behavior

- A stale revision/source snapshot refreshes the document and explains that another operation won.
- An unresolved AI draft refreshes into the existing draft failure screen; manual editing never deletes it.
- Source validation or full-build failure keeps the current compiled revision visible and shows the returned failure summary.
- While a command or its complete visual frame is pending, the committed frame remains selectable and property, text, and drag gestures append typed intents with immediate previews. Exact-revision submission remains serialized, so the backend never receives a command against a stale base.
- A committed response is an accepted source revision, not proof that the new pixels are visible. The feature keeps `pendingPresentationRevision` until the matching or newer complete visual frame reaches the stage. It also handles the inverse race where that frame arrives before the command response.
- Command refresh and `workspace.document.updated(version)` refresh carry the target revision into one coalesced read. A completed duplicate is skipped, and a late request for a previously open document cannot reactivate or overwrite the current document.
- If the first IPC response is lost, the workflow retries once with the same command ID; the backend receipt returns the already committed revision instead of creating a duplicate.
- A document switch resets all feature state. A RenderModel revision update reconciles selection by stable render ID.

## Tests

- `functions/manualEditableTargets.test.ts`: explicit author capabilities, topmost hit testing, parent-first Frame paths, source-span independence, flattened Frame translation scope, locked/rich/formula text boundaries.
- `functions/manualEditingAvailability.test.ts`: generated/ready/exact-version gate.
- `orchestration/submitManualEdit.test.ts`: exact command snapshot, refresh behavior and unavailable snapshots.
- `functions/resolveManualClickSelection.test.ts`: parent-first descent, direct sibling switching, nested branch boundaries and unrelated paths.
- `functions/appendManualEditIntent.test.ts`: adjacent style and translation coalescing without crossing author targets.
- `orchestration/useSlideManualEditingInteraction.test.ts`: drag-to-pending promotion, parent-first repeated-click descent, sibling switching during a style revision, stable Frame drag ownership, queued interaction during compilation, and deferred selection after text presentation.
- `functions/resolveManualSelectionBreadcrumbStyle.test.ts`: selected-bounds top-edge-center placement.
- `functions/manualVisualPreview.test.ts`: immediate text/fill/size/deletion projection and size-selection geometry.
- `store/slidesManualEditingStore.test.ts`: serialized intent state, optimistic translation/property visuals, whole-queue failure rollback and committed revision presentation settlement.
- `features/elementProperties`: capability-bound command construction, move-only panel suppression and property-panel assembly.
- `features/textEditing`: committed text projection, zoomed DOM geometry, IME-safe submission, unchanged-draft close and failed-save draft ownership.
- `page/SlidesView.test.ts`: component-level command submission, post-commit refresh and next-intent dispatch against the newly presented exact revision.
- Backend orchestration, IPC parsing, source rewrite, CAS, draft protection and receipt tests remain in `backend/features/presentationManualEditing`, `backend/ipc` and persistence suites.
- `smoke:preview-transitions` mounts the production `KonvaSlideStage` and verifies that one Frame preview delta moves multiple related content nodes in the same real Chromium frame. On one persistent Shape node it also checks fill, visual size, Frame-delete hiding and A→B→A restoration, in addition to the existing persistent-paint pixel comparisons.

## Performance trace

Each accepted command uses its UUID as the Renderer/Backend correlation ID. When
`localStorage['linnya.slides.debug']` is set to `verbose`, the Renderer emits structured
`Slides/ManualEditTrace` events for request start, retry, response, refresh completion and the first
browser animation frame after the complete target revision is installed. The terminal
`frame_presented` event includes input-to-response, response-to-refresh, refresh-to-frame and total
input-to-frame timings. Backend `slides_manual_edit.backend_trace` events use the same command ID and
identify `projected_translation` versus `full_compile` without logging source or edited content.
