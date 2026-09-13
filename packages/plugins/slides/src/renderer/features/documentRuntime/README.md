# Slides document runtime

`documentRuntime` owns active-document loading and version refresh coordination for the Slides renderer surface.

`contribution.ts` adapts the Host document-runtime request to the Slides deck store and optional page targeting. `createActiveDeckRefreshCoordinator` is the store-independent orchestration for refreshes triggered by write-command responses and `workspace.document.updated` events. It accepts narrow ports for active-document identity, loaded revision state and the actual read operation.

The coordinator enforces three rules:

- a refresh can only read the document that is still active;
- concurrent requests for the same document share one read;
- a version-aware request skips an already loaded revision and may perform one follow-up read when it joined work that began before its target revision existed.

The deck store remains the owner of current document and preview state. The coordinator neither imports Pinia nor changes state directly, so document identity and async deduplication can be tested without mounting the renderer.
