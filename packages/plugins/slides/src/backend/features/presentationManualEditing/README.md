# Presentation manual editing

This feature owns deterministic user edits for generated `deck.js` documents. It rewrites only the machine-owned `compose.manualEdits` literal and later orchestrates candidate compilation and revision commit. It does not mutate DeckSpec, PPTX or Renderer state as a second source of truth.

Current source rules:

- the document contains exactly one `compose({...})` object;
- `manualEdits` is a static JSON literal and is parsed by the shared strict codec;
- unrelated source text and comments remain byte-for-byte unchanged;
- text writes replace the complete plain-text author value; translation writes the complete cumulative `dx / dy` value;
- source size is checked before the candidate reaches the build pipeline.

