# Slides document runtime

`documentRuntime` owns active-document loading and version refresh coordination for the Slides renderer surface.

`fileHandler.ts` contributes the existing Host file-session lifecycle: open reads the document and optional target page; save calls the mounted surface save participant; close resets the deck only after Host has accepted save. Slides no longer uses the read-only runtime loader. `navigationParameters` in the session payload carries document target parameters. `createActiveDeckRefreshCoordinator` is the store-independent orchestration for refreshes triggered by write-command responses and `workspace.document.updated` events. It accepts narrow ports for active-document identity, loaded revision state and the actual read operation.

The coordinator enforces three rules:

- a refresh can only read the document that is still active;
- concurrent requests for the same document share one read;
- a version-aware request skips an already loaded revision and may perform one follow-up read when it joined work that began before its target revision existed.

The deck store remains the owner of current document and preview state. The coordinator neither imports Pinia nor changes state directly, so document identity and async deduplication can be tested without mounting the renderer.

`SlidesView` renders from the ready build-state revision identity. It does not wait for a second DeckPreview event or consume an “initial preview” flag: the document may already be loaded before the surface mounts. Every new ready revision schedules a RenderModel read while keeping the previous complete frame visible.

## Save boundary

`ports/documentSaveParticipant` exposes only current document identity and an awaited save operation. The page composition root connects it to input handoff and the manual edit queue. Export and the Host file lifecycle call the same public save boundary; they never inspect another feature's queue or simulate blur. An unmounted surface has no local input; normal Host navigation must save while the old surface is still mounted.

The barrier commits an active text session, drains every admitted command, and captures text typed during the wait. Background auto-save defers while a text session owns input and returns false so Host keeps dirty; it never ends typing or IME. Explicit save/navigation/export finishes input. Unconfirmed IME input and failed text drafts reject saving. Host then keeps the document open; export keeps its dialog and reports the failure. The last backend committed result is sufficient for durable save even when its pixels have not appeared. Intermediate queued commands still require their exact revision/frame before dispatch. App termination/crash and development hot reload are not draft persistence guarantees.

Silent document-read errors propagate to the queue while retaining the existing preview. RenderModel read errors are also observable by the queue; refresh retry can reload a failed model even if the deck read has already reached the target revision.
