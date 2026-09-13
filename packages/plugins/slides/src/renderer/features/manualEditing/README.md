# Slides limited manual editing

`manualEditing` owns the Renderer side of limited editing for generated `deck.js` presentations. It selects only compiler-projected author objects, previews a drag without mutating RenderModel, and submits a strict command against the exact revision/source snapshot. The backend remains the only writer. It may use the proven post-layout translation projection for a unique top-level atomic object; all other edits use the full author compiler. Both paths commit the semantic revision without waiting for PPTX assembly and publish the same revision contract.

## Current interaction

- The toolbar edit button is available only for a ready generated document whose visible RenderModel version equals the build-state revision and whose current slide contains at least one editable author object.
- Clicking an object selects it. Dragging previews a translation on the main Konva stage; releasing promotes that delta to a local pending translation before sending one `translate_by` operation in inches. The object therefore stays under the pointer while the source-first rebuild runs. The pending visual is removed only after the committed RenderModel revision and its current-page image/chart resources form the displayed frame, or rolled back on failure.
- Double-clicking a text object whose backend `authoringEdit` projection declares `set_text_content` opens a focused textarea over its bounds. The editor lives in the scroll-content overlay rather than inside the clipped slide canvas. Save replaces the complete author string and runs the normal backend text measurement and layout pipeline. IME composition cannot accidentally trigger the save shortcut; a failed save retains the editor and draft for correction or retry. Multiline strings and strings split into Latin/East Asian render runs remain editable because their author value is still one string.
- Rich author runs and inline formula runs remain text-read-only because replacing them with one string would destroy run semantics. They may still move.
- Image, table, chart, shape, SVG Graphic and formula author objects may move. Their content/data/source editors are later independent feature slices.
- A decorated Flex Frame is selected through its background and moves as one author object. The compiler projects every flattened descendant's `authoringAncestorRefs`; the target mapper turns that relation into the exact RenderNode roots that share one optimistic translation. Child text and visual objects keep their own author identity, so clicking them can still select and edit the child independently. Nested rendered Groups contribute only their outer affected root, avoiding a double transform.

The existing source-selection/AI-edit mode and manual-edit mode are mutually exclusive. Both consume compiler facts from the same RenderModel and share the same pointer-to-slide coordinate function. Source selection may admit any node with source ownership, while manual editing additionally requires an explicit author identity and capability; their transient selections and write workflows remain in separate feature stores.

## Layers

```text
definitions/
  manualEditingTypes + localized message catalog
functions/
  author-capability target projection, hit testing, availability, command creation, result messages
orchestration/
  pointer drag/text session + submit/refresh workflow
store/
  mode, selected target, gesture/pending visual state, text draft, submission/presentation state
ui/
  localization adapter
```

The store never calls IPC and never contains geometry or conflict rules. Generic world-coordinate traversal belongs to the sibling `renderNodeSelection` feature; manual editing contributes only its author-capability predicate and target mapping. `SlidesView` is the app-level assembly point: it supplies the current document snapshot to `submitManualEdit`, invokes `slidesApi`, and requests the committed revision. `SlideStage` records presentation only when `renderVisualResources` has atomically installed the target page frame.

## Conflict and failure behavior

- A stale revision/source snapshot refreshes the document and explains that another operation won.
- An unresolved AI draft refreshes into the existing draft failure screen; manual editing never deletes it.
- Source validation or full-build failure keeps the current compiled revision visible and shows the returned failure summary.
- While a command is running, additional manual pointer operations are disabled, but the stage keeps a normal cursor and the accepted local visual instead of flashing back and showing a global wait cursor.
- A committed response is an accepted source revision, not proof that the new pixels are visible. The feature keeps `pendingPresentationRevision` until the matching or newer complete visual frame reaches the stage. It also handles the inverse race where that frame arrives before the command response.
- Command refresh and `workspace.document.updated(version)` refresh carry the target revision into one coalesced read. A completed duplicate is skipped, and a late request for a previously open document cannot reactivate or overwrite the current document.
- If the first IPC response is lost, the workflow retries once with the same command ID; the backend receipt returns the already committed revision instead of creating a duplicate.
- A document switch resets all feature state. A RenderModel revision update reconciles selection by stable render ID.

## Tests

- `functions/manualEditableTargets.test.ts`: explicit author capabilities, topmost hit testing, source-span independence, flattened Frame translation scope, locked/rich/formula text boundaries.
- `functions/manualEditingAvailability.test.ts`: generated/ready/exact-version gate.
- `orchestration/submitManualEdit.test.ts`: exact command snapshot, refresh behavior and unavailable snapshots.
- `orchestration/useSlideManualEditingInteraction.test.ts`: drag-to-pending promotion, operation payload and IME-safe text submission.
- `store/slidesManualEditingStore.test.ts`: optimistic translation settlement and failed/committed text draft lifecycle.
- `page/SlidesView.test.ts`: component-level command submission and post-commit refresh.
- Backend orchestration, IPC parsing, source rewrite, CAS, draft protection and receipt tests remain in `backend/features/presentationManualEditing`, `backend/ipc` and persistence suites.
- `smoke:preview-transitions` mounts the production `KonvaSlideStage` and verifies that one Frame preview delta moves multiple related content nodes in the same real Chromium frame, in addition to the existing persistent-paint pixel comparisons.

## Performance trace

Each accepted command uses its UUID as the Renderer/Backend correlation ID. When
`localStorage['linnya.slides.debug']` is set to `verbose`, the Renderer emits structured
`Slides/ManualEditTrace` events for request start, retry, response, refresh completion and the first
browser animation frame after the complete target revision is installed. The terminal
`frame_presented` event includes input-to-response, response-to-refresh, refresh-to-frame and total
input-to-frame timings. Backend `slides_manual_edit.backend_trace` events use the same command ID and
identify `projected_translation` versus `full_compile` without logging source or edited content.
