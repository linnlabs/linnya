# Presentation manual editing

This feature owns deterministic user edits for generated `deck.js` documents. It rewrites only the machine-owned `compose.manualEdits` literal and orchestrates candidate compilation and revision commit. It does not mutate DeckSpec, PPTX or Renderer state as a second source of truth.

Current source rules:

- the document contains exactly one `compose({...})` object;
- `manualEdits` is a static JSON literal and is parsed by the shared strict codec;
- unrelated source text and comments remain byte-for-byte unchanged;
- text writes replace the complete plain-text author value; absolute translation writes the complete cumulative `dx / dy` value, while renderer drag commands use `translate_by` so repeated drags accumulate against the checked base revision;
- source size is checked before the candidate reaches the build pipeline.

Repository integration adds two commit invariants for this feature:

- `expectedDraftState: "absent"` is checked inside the final revision transaction, so an Agent draft created during a user edit cannot be silently deleted by the manual commit;
- the command ID, payload digest and committed revision are stored in `presentation_manual_edit_receipts` in that same transaction. Retrying the same command returns its original revision; reusing the ID with another payload fails.

`PresentationManualEditingRuntime` is the only write orchestration entry. Within the document revision scope it checks an existing receipt, validates the exact revision/source snapshot and unresolved-draft state, then rewrites the source. A `translate_by` for one unique top-level atomic author object is a post-layout operation, so the feature projects the same delta onto the current DeckSpec and skips sandbox/Flex recomputation. Text changes, Frames, nested group targets and any operation whose equivalence cannot be proved still use the normal full compiler. Both paths commit `deckSource + DeckSpec` through the same final CAS transaction, draft guard and command receipt with `origin: "edit"`; neither waits for PPTX assembly.

The translation projection is a pure feature function. It requires exactly one matching `slideKey/editKey`, checks the compiled target kind, copies only the affected DeckSpec path, and moves both the element box and generated layout evidence. Missing, duplicate or contradictory author identities fail as validation errors; they are never resolved by geometry or display text. `CodegenDeckBuilder.commitManualEditFromProjectedDeckSpec` is the narrow trusted boundary that records the unchanged source theme and commits the projected semantic revision without pretending that author diagnostics were rerun.

The repository marks these revisions with no current PPTX artifact and inherits the base revision's theme/asset reachability inside the commit transaction. Native PPTX export and OOXML inspection later use [`presentationPptxArtifact`](../presentationPptxArtifact/README.md) to materialize and revision-CAS the package. RenderModel, preview, screenshots and raster export continue directly from DeckSpec.

Expected validation, build and conflict outcomes return the shared `SlidesManualEditCommandResult` union; unexpected infrastructure failures still propagate to the IPC envelope. `CodegenDeckBuilder` preserves stale-base, stale-source, draft and command-receipt exceptions raised by the final repository transaction, so the runtime can map races discovered at commit time to the same explicit conflict union instead of misreporting them as persistence build failures.

The Renderer reaches this flow only through `slides:manual-edit`. The backend parser rejects unknown fields, invalid author keys, non-finite translations, malformed revision snapshots and non-UUID command IDs before coordinator logic runs.
