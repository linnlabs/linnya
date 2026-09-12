# Slides limited manual editing

`manualEditing` owns the Renderer side of limited editing for generated `deck.js` presentations. It selects only compiler-projected author objects, previews a drag without mutating RenderModel, and submits a strict command against the exact revision/source snapshot. The backend remains the only writer and always rebuilds DeckSpec, RenderModel and PPTX before committing a revision.

## Current interaction

- The toolbar edit button is available only for a ready generated document whose visible RenderModel version equals the build-state revision and whose current slide contains at least one editable author object.
- Clicking an object selects it. Dragging previews a translation on the main Konva stage; releasing sends one `translate_by` operation in inches. Repeated drags accumulate in backend `manualEdits`.
- Double-clicking a single-paragraph, single-run text object opens a focused textarea over its bounds. Save replaces the complete author text and runs the normal backend text measurement and layout pipeline.
- Rich text, inline formula text and multi-paragraph text remain text-read-only because replacing them with one string would destroy run semantics. They may still move.
- Image, table, chart, shape, SVG Graphic and formula author objects may move. Their content/data/source editors are later independent feature slices.
- Flex Frame targets are currently withheld from the UI. The generated RenderModel flattens a Frame into a decoration plus descendants, so moving only the decoration during preview would misrepresent the committed result. The compiler still carries `targetKind: "frame"` for a later whole-subtree interaction.

The existing source-selection/AI-edit mode and manual-edit mode are mutually exclusive. Both share the same pointer-to-slide coordinate function, while their selections and workflows remain in separate feature stores.

## Layers

```text
definitions/
  manualEditingTypes + localized message catalog
functions/
  editable-target projection, hit testing, availability, command creation, result messages
orchestration/
  pointer drag/text session + submit/refresh workflow
store/
  mode, selected target, transient translation preview, submission/error state
ui/
  localization adapter
```

The store never calls IPC and never contains geometry or conflict rules. `SlidesView` is the app-level assembly point: it supplies the current document snapshot to `submitManualEdit`, invokes `slidesApi`, and refreshes the document after commit or conflict. `SlideStage` only connects pointer events and renders the transient overlay.

## Conflict and failure behavior

- A stale revision/source snapshot refreshes the document and explains that another operation won.
- An unresolved AI draft refreshes into the existing draft failure screen; manual editing never deletes it.
- Source validation or full-build failure keeps the current compiled revision visible and shows the returned failure summary.
- While a command is running, additional manual pointer operations are disabled.
- If the first IPC response is lost, the workflow retries once with the same command ID; the backend receipt returns the already committed revision instead of creating a duplicate.
- A document switch resets all feature state. A RenderModel revision update reconciles selection by stable render ID.

## Tests

- `functions/manualEditableTargets.test.ts`: author identity, topmost hit testing, locked/rich/formula text boundaries.
- `functions/manualEditingAvailability.test.ts`: generated/ready/exact-version gate.
- `orchestration/submitManualEdit.test.ts`: exact command snapshot, refresh behavior and unavailable snapshots.
- `store/slidesManualEditingStore.test.ts`: synchronous feature state transitions.
- `page/SlidesView.test.ts`: component-level command submission and post-commit refresh.
- Backend orchestration, IPC parsing, source rewrite, CAS, draft protection and receipt tests remain in `backend/features/presentationManualEditing`, `backend/ipc` and persistence suites.
