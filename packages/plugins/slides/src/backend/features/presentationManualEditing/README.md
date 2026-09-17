# Presentation manual editing

This feature owns deterministic user edits for generated `deck.js` documents. It rewrites only the machine-owned `compose.manualEdits` literal and orchestrates candidate compilation and revision commit. It does not mutate DeckSpec, PPTX or Renderer state as a second source of truth.

Current source rules:

- the document contains exactly one `compose({...})` object;
- `manualEdits` is a static JSON literal and is parsed by the shared strict codec;
- unrelated source text and comments remain byte-for-byte unchanged;
- text writes carry explicit Text/Shape target kind and replace the complete plain-text author value; Shape content merges with its existing fill, size and translation rather than creating a child Text record; text style writes merge font size/color; Frame/Shape fill writes replace the solid background/fill; Shape/Image visual-size writes replace width/height and atomically accumulate an optional resize-anchor translationDelta into the existing translation; deleting any editable author target replaces its record with the exclusive deletion marker;
- absolute translation writes the complete cumulative `dx / dy` value, while renderer drag commands use `translate_by` so repeated drags accumulate against the checked base revision;
- source size is checked before the candidate reaches the build pipeline.

Repository integration adds two commit invariants for this feature:

- `expectedDraftState: "absent"` is checked inside the final revision transaction, so an Agent draft created during a user edit cannot be silently deleted by the manual commit;
- the command ID, payload digest and committed revision are stored in `presentation_manual_edit_receipts` in that same transaction. Retrying the same command returns its original revision; reusing the ID with another payload fails.

`PresentationManualEditingRuntime` is the only write orchestration entry. Within the document revision scope it checks an existing receipt, validates the exact revision/source snapshot and unresolved-draft state, then rewrites the source. A `translate_by` for one unique top-level atomic author object is a post-layout operation, so the feature projects the same delta onto the current DeckSpec and skips sandbox/Flex recomputation. Text content/style, color, size, deletion, Frames, nested group targets and any operation whose equivalence cannot be proved use the normal full compiler. The compiler applies text style and fill before layout, removes deleted atomic targets or complete Frame subtrees before Yoga, and applies Shape/Image visual size after Yoga. Frame compilation applies translation to the decoration and all descendants; the generated RenderModel preserves that same author ancestry so the Renderer preview and committed result have identical scope. Both paths commit `deckSource + DeckSpec` through the same final CAS transaction, draft guard and command receipt with `origin: "edit"`; neither waits for PPTX assembly.

The translation projection is a pure feature function. It requires exactly one matching `slideKey/editKey`, checks the compiled target kind, copies only the affected DeckSpec path, and moves both the element box and generated layout evidence. Missing, duplicate or contradictory author identities fail as validation errors; they are never resolved by geometry or display text. `CodegenDeckBuilder.commitManualEditFromProjectedDeckSpec` is the narrow trusted boundary that records the unchanged source theme and commits the projected semantic revision without pretending that author diagnostics were rerun.

The repository marks these revisions with no current PPTX artifact and inherits the base revision's theme/asset reachability inside the commit transaction. Native PPTX export and OOXML inspection later use [`presentationPptxArtifact`](../presentationPptxArtifact/README.md) to materialize and revision-CAS the package. RenderModel, preview, screenshots and raster export continue directly from DeckSpec.

Expected validation, build and conflict outcomes return the shared `SlidesManualEditCommandResult` union; unexpected infrastructure failures still propagate to the IPC envelope. `CodegenDeckBuilder` preserves stale-base, stale-source, draft and command-receipt exceptions raised by the final repository transaction, so the runtime can map races discovered at commit time to the same explicit conflict union instead of misreporting them as persistence build failures.

The Renderer reaches this flow only through `slides:manual-edit`. The backend parser rejects unknown fields, invalid author keys, non-finite translations/sizes, invalid colors/font sizes, malformed revision snapshots and non-UUID command IDs before coordinator logic runs.

## End-to-end trace

The command UUID is also the cross-process trace identity. Production backend wiring emits
`slides_manual_edit.backend_trace` for request admission, snapshot validation, source rewrite,
selected build path, semantic commit and terminal rejection. Events contain IDs, stage, path,
revision and elapsed milliseconds; they never contain edited text or deck source.

The Renderer feature owns the user-visible half of the trace. With Slides verbose diagnostics enabled
(`localStorage['linnya.slides.debug'] = 'verbose'`), `ManualEditTrace` records request start, an
idempotent transport retry, IPC response, revision-targeted refresh completion and the first animation
frame after the complete slide resource frame is installed. The terminal event reports
`inputToResponseMs`, `responseToRefreshMs`, `refreshToFrameMs` and `inputToFrameMs`. A negative
intermediate duration is retained when push delivery presents the revision before the IPC/refresh
path completes; this describes the real race instead of rewriting its order.

The Flex authoring integration test materializes a real PPTX from a v2 edit fixture and inspects the
slide XML for text/font color, point size, Shape width/height, fill color and deleted Frame content.
This keeps export evidence on the same compiler output instead of duplicating manual-edit rules in an
export-only test adapter.
