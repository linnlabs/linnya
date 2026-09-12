# Presentation manual editing

This feature owns deterministic user edits for generated `deck.js` documents. It rewrites only the machine-owned `compose.manualEdits` literal and later orchestrates candidate compilation and revision commit. It does not mutate DeckSpec, PPTX or Renderer state as a second source of truth.

Current source rules:

- the document contains exactly one `compose({...})` object;
- `manualEdits` is a static JSON literal and is parsed by the shared strict codec;
- unrelated source text and comments remain byte-for-byte unchanged;
- text writes replace the complete plain-text author value; translation writes the complete cumulative `dx / dy` value;
- source size is checked before the candidate reaches the build pipeline.

Repository integration adds two commit invariants for this feature:

- `expectedDraftState: "absent"` is checked inside the final revision transaction, so an Agent draft created during a user edit cannot be silently deleted by the manual commit;
- the command ID, payload digest and committed revision are stored in `presentation_manual_edit_receipts` in that same transaction. Retrying the same command returns its original revision; reusing the ID with another payload fails.
