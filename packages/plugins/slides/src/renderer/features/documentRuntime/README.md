# Slides document runtime

`documentRuntime` owns active-document loading, snapshot assembly, selection installation and version refresh coordination. `fileHandler` connects Host open/save/close; asynchronous work lives in `orchestration`, while `store/slidesDocumentStore` only holds state and performs synchronous writes.

## Read and install

`useSlidesDocumentRuntime` is the public read boundary. It reads `slides:view-snapshot`, assembles all batches of the same snapshot, restores missing content/binding blocks and validates complete pages. The protocol is defined in [presentationViewSnapshot](../../../shared/presentationViewSnapshot/README.md).

A single installed reference contains build state, navigation, RenderModel and selection. The feature public entry exports the document store; `slidesRenderStore` is a read-only projection with no independent request or model state. `SlidesView` never schedules model reads in a revision watcher. Preloaded documents and newly mounted surfaces consume the same installed view.

`createActiveDeckRefreshCoordinator` coalesces command receipts and mutation events in the same document session epoch. Only a complete installed ready snapshot satisfies a requested revision. A→B→A visits cannot join an earlier A read. An unversioned refresh always checks current state, including draft updates on an unchanged compiled base. Concurrent version requests can share the current read and one follow-up when the target revision did not yet exist.

The client retains only blocks and page objects referenced by the installed document. A read pins its reported baseline until assembly finishes; unchanged content plus bindings reuse the old page object. Opening another document or closing releases these caches. Candidates from stale session epochs are discarded. Resource loading keeps the previous complete frame until the new target page is ready; ready→draft removes the old editable view.

## Structure selection

The page workflow supplies `preparePresentation` to the generic manual queue. It prepares one selection intent for a logical structure command, shared by idempotent transport retries; success confirms its revision and failure cancels it. If a version event arrives before the receipt, the candidate waits for ownership confirmation before installation. Target index and new page list enter the same synchronous state update. A later explicit user selection takes precedence; older numeric targets never apply to a newer revision.

`deckNavigator` only submits operations and awaits tickets. It has no watcher or post-settlement selection repair. The runtime validates view frame reports against the active document, revision and current page. The queue reads the runtime presented revision through a port. Single-page rendering waits for images/charts; grid rendering waits for the current page thumbnail. Installing data alone does not complete presentation.

## Save boundary

`ports/documentSaveParticipant` exposes only current document identity and an awaited save operation. The page composition root connects it to input handoff and the manual edit queue. Export and the Host file lifecycle call the same public save boundary; they never inspect another feature's queue or simulate blur. An unmounted surface has no local input; normal Host navigation must save while the old surface is still mounted.

The barrier commits an active text session, drains every admitted command, and captures text typed during the wait. Background auto-save defers while a text session owns input and returns false so Host keeps dirty; it never ends typing or IME. Explicit save/navigation/export finishes input. Unconfirmed IME input and failed text drafts reject saving. Host then keeps the document open; export keeps its dialog and reports the failure. The last backend committed result is sufficient for durable save even when its pixels have not appeared. Intermediate queued commands still require their exact revision/frame before dispatch. App termination/crash and development hot reload are not draft persistence guarantees.

Silent document-read errors propagate to the queue while retaining the existing preview. Snapshot read errors propagate to the queue. The installed complete view remains available, and retry reads the snapshot without resubmitting the committed command.

A running Backend keeps its loaded protocol until it exits; Renderer hot updates do not restart it. A snapshot format mismatch is rejected before any blocks or pages are installed, with an explicit instruction to restart the current instance. The client never relabels an old snapshot as the current format or retries an incompatible version in a loop. Verification after a protocol change must include opening a document in a fully restarted Desktop, alongside compiler and CLI checks.

Navigation count/current page derive from RenderModel. DeckPreview remains a summary projection for context and export;
it does not define navigation bounds. `usePresentedFrame` owns animation-frame scheduling and cancellation on view disposal.
Presentation resource failures are reported separately from snapshot read failures and unblock the queue with a refresh error.
