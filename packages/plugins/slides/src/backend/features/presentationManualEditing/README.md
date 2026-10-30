# Presentation manual editing

This feature owns deterministic user edits for generated `deck.js` documents. Object edits rewrite only the machine-owned `compose.manualEdits` literal; inserting a blank slide adds one top-level slide declaration and its entry in `compose.slides`. Copying/deleting a slide rewrites its source block and the static page list, and copies/removes its manual values. The feature orchestrates candidate compilation or proven-equivalent projection and revision commit. It does not mutate DeckSpec, PPTX or Renderer state as a second source of truth.

Current source rules:

- the document contains exactly one `compose({...})` object;
- `manualEdits` is a static JSON literal and is parsed by the shared strict codec;
- unrelated source text and comments remain byte-for-byte unchanged;
- text writes carry explicit Text/Shape target kind and replace the complete author value (Text string/runs, Shape string); Shape content merges with its existing fill, size and translation rather than creating a child Text record; text style writes merge font size/color; Frame/Shape fill writes replace the solid background/fill; Shape/Image visual-size writes replace width/height and atomically accumulate an optional resize-anchor translationDelta into the existing translation; deleting any editable author target replaces its record with the exclusive deletion marker;
- absolute translation writes the complete cumulative `dx / dy` value, while renderer drag commands use `translate_by` so repeated drags accumulate against the checked base revision;
- source size is checked before the candidate reaches the build pipeline.

Blank slide insertion (`insert_blank_slide`, `index` = 0-based position in the exact checked revision):

- the single top-level `compose({...})` must list pages as a static array of identifiers, either inline (`slides: [a, b]`) or through one top-level `const` array; spreads, calls, expressions, or a list whose length differs from the current DeckSpec are rejected as `slides_not_static`. The writer never guesses page order from display order, line numbers or text;
- the page that will follow the new one must be declared by exactly one top-level `const|let|var x = createSlide(...)`. The new declaration is placed immediately before that statement (or before the statement that evaluates the slides array when appending), after the previous statement's line, so trailing comments stay on their line and the next page keeps its leading comment. Source blocks retain declaration ownership; `SlideMarkerIndex` labels them using proven compose order;
- names are `blankSlideN` / `blank-slide-N` with the lowest N whose text does not already appear anywhere in the source; once written they are ordinary stable author identities;
- the background is the current revision's normalized `theme.colors.background`, or `#FFFFFF` (the default for an undeclared background) when the theme declares none;
- with an inline page array and no spread/computed compose properties, adding the independent empty factory call leaves existing author objects unchanged. `projectBlankSlideInsertion` reuses their compiled geometry, inserts the empty page, and rebases source spans, diagnostic labels and layout page identities. It skips sandbox startup and whole-deck layout while using the same atomic commit, draft guard, command receipt and deferred PPTX path;
- a named array may be read by other author statements, and a declaration inserted in the middle of a source line cannot be rebased with line-only spans. These cases continue through the full compiler;
- existing `manualEdits` records are untouched because they are keyed by `slideKey`, not position. Integration tests compare projected DeckSpec against a real full compile at the beginning, middle and end, including nested Frames, rich text, existing manual values and shared helper source spans.

Slide copy/deletion (`duplicate_slide` / `delete_slide`, exact-revision 0-based `index`):

- the static compose list determines display order, independently of top-level declaration order. Page configs and slide keys must be explicit literals; dynamic identity/spreads are rejected rather than silently omitting manual values from the copy. A page block ends before the next page declaration or the statement evaluating the page array; adjacent leading comments are retained;
- copying inserts immediately after the original, creates a fresh `copied-slide-N` identity, and scopes copied page-local declarations in a block to avoid name collisions. The original page variable is bound to the new page inside that block; no object alias or clipboard state connects the two pages;
- copying preserves that page's current manual values under the new identity. Deletion removes its corresponding manual records. A presentation retains at least one page;
- both operations use the full compiler. Source blocks with cross-page variable dependencies may be rejected if removing a page would break another page; compilation failure never commits partial source or changes the current document. Dynamic page lists must be changed through the source workflow.

Repository integration adds two commit invariants for this feature:

- `expectedDraftState: "absent"` is checked inside the final revision transaction, so an Agent draft created during a user edit cannot be silently deleted by the manual commit;
- the command ID, payload digest and committed revision are stored in `presentation_manual_edit_receipts` in that same transaction. Retrying the same command returns its original revision; reusing the ID with another payload fails.

`PresentationManualEditingRuntime` is the only write orchestration entry. Within the document revision scope it checks an existing receipt, validates the exact revision/source snapshot and unresolved-draft state, then rewrites the source. A `translate_by` for one unique top-level atomic author object is a post-layout operation, so the feature projects the same delta onto the current DeckSpec and skips sandbox/Flex recomputation. Text content/style, color, size, deletion, Frames, nested group targets and any operation whose equivalence cannot be proved use the normal full compiler. The compiler applies text style and fill before layout, removes deleted atomic targets or complete Frame subtrees before Yoga, and applies Shape/Image visual size after Yoga. Frame compilation applies translation to the decoration and all descendants; the generated RenderModel preserves that same author ancestry so the Renderer preview and committed result have identical scope. Both paths commit `deckSource + DeckSpec` through the same final CAS transaction, draft guard and command receipt with `origin: "edit"`; neither waits for PPTX assembly.

The translation projection is a pure feature function. It requires exactly one matching `slideKey/editKey`, checks the compiled target kind, copies only the affected DeckSpec path, and moves both the element box and generated layout evidence. Missing, duplicate or contradictory author identities fail as validation errors; they are never resolved by geometry or display text. `CodegenDeckBuilder.commitManualEditFromProjectedDeckSpec` is the narrow trusted boundary that records the unchanged source theme and commits the projected semantic revision without pretending that author diagnostics were rerun.

The repository marks these revisions with no current PPTX artifact. Proven-equivalent projections inherit base theme/asset reachability; full compilation records newly resolved image/SVG reachability, and history restoration inherits the exact restored revision context. Native PPTX export and OOXML inspection later use [`presentationPptxArtifact`](../presentationPptxArtifact/README.md) to materialize and revision-CAS the package. RenderModel, preview, screenshots and raster export continue directly from DeckSpec.

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


Text 的 set_text_content 现接纳源码同型的字符串或纯文字 run 数组；Shape 仍只接纳字符串。完整富文本人工值通过现有源码 manualEdits 块、CAS、revision 与延迟 PPTX 链路保存，不能另建 HTML 文档或偏移补丁日志。选区样式的应用在前端输入会话完成，后端只接纳完整作者值；源节点含公式时仍拒绝覆盖。幂等摘要包含全部 run 样式，并忽略样式对象属性的排列顺序。保存重开集成测试同时验证未选中 run 样式与局部字号／颜色在导出 XML 中保留。

整框 set_text_style 同时支持纯文本与纯文字富文本。`prepareManualEditSourceOperation` 在 CAS 快照验证之后读取当前 DeckSpec 中唯一 Text 的原始作者正文，形成仅后端使用的完整样式写入输入；不读取 RenderModel 行片段，不重新执行源码，不扩张 IPC。writer 对富文本的每个 run 覆盖本次字号／颜色，同时更新该对象的节点继承字段，保留其他样式、位移和无关源码。

既有 v2 语义保持不变：显式 run 样式优先于节点／manual 字段的继承样式。后来的局部完整正文自然覆盖前一轮整框操作，不需要清理旧字段或迁移旧文稿。`collectManualAuthoringTargets` 为整框格式与已存在的平移快速路径共享精确作者身份遍历，支持嵌套 group；缺失、重复、错误类型及含公式正文拒绝本次格式操作，不猜测目标。样式修改仍走正常完整编译／修订／延迟 PPTX 链路，DeckSpec 仅提供同修订的作者值，不成为第二个可写真源。


## Web editing commands

- `prepareManualEditBatch` checks all targets against the same exact DeckSpec. Operations are written in order, so the same target may be edited more than once in one batch (the writer folds them into its single current-value record); it rejects editing a target after deleting it in the same batch, and an ancestor together with its descendant. The source block is written once, compiled once and committed once; failure leaves the original revision intact.
- `insertObjectsAtSlide` requires static compose order and an explicit literal slideKey. New objects are stored in that slide's additions and compiled as normal nodes. Deleting an inserted object removes its addition together with its target record and paint-order entry (and the slide entry once empty) instead of leaving a `deleted` marker, so `deck.js` does not grow with editing; undo restores the earlier revision. Deleting a generated author object still records `deleted: true`, because its factory call stays in source. The AI-facing declarations include `SlidesInsertedObject`, and the skill guide tells the agent to keep `additions` and `paintOrder` intact. Plain text/solid rect/ellipse/document-owned images use the strict shared contract. `copyManualObjects` reads exact author values from DeckSpec, not render lines; unsupported complex objects are rejected explicitly. Same-deck image copies reuse owned IDs.
- `moveSlideInDeckSource` edits only the static page array. Copy/delete select source block boundaries in declaration order, even after display reorder. Fast blank insertion additionally requires declaration/display alignment; other cases compile normally.
- `changeManualLayer` changes keyed sibling paint order after Yoga. Geometry and Flex occupancy remain unchanged. It never reparents objects or turns rendering IDs into source identity.
- `set_text_width` applies before Yoga, preserves height; emphasis/alignment preserve explicit run styles except the fields being changed. `set_image` replaces an owned source/fit without changing its box.
- `ManualEditHistoryStore` holds at most 50 logical edits per document in the backend session. One edit is one before/after revision pair. Undo/redo compile the selected historical source/theme into a new revision, with normal CAS, receipt and deferred PPTX. A new edit after undo clears redo. Each entry also records the affected slide index before and after the edit plus the edited `slideKey/editKey` refs; an undo/redo commit returns that `focus` so the Renderer can reveal the slide and reselect the objects. An external revision invalidates the session stack; restarting the plugin starts a new stack. Durable source history remains separate.
- Required undo/redo revision IDs participate in history compaction, keeping their image/SVG references reachable. The stack stores identities rather than full source, DeckSpec, bitmaps or PPTX buffers.

Translation projection is restricted to deltas on the compiler's 1e-4-inch geometry grid (`isManualTranslationOnGrid`, tolerant of binary floating-point residue); the projected box is rounded by the compiler's own rule. The Renderer quantizes drag, nudge and arrangement deltas to that grid, so ordinary edits stay on the fast path; off-grid deltas from other clients use full compilation from cumulative source values so 96 one-pixel nudges equal one inch. Rewriting `manualEdits` moves the source lines of inserted-object literals, so a projected snapshot re-reads their spans from the new source (`relocateInsertedObjectSpans`) instead of falling back to a full compile. No compiler or IPC runs per pointer move/key repeat.

The real compiler + SQLite integration fixture `backend/__tests__/manual-edit-history.integration.test.ts` covers 30 pages, atomic batch rollback, idempotency, 50 retained undo steps, exact nudges, source location, copy/reorder/delete, image replacement/deletion/undo and ownership denial. Setting `SLIDES_EDITING_BENCHMARK_OUTPUT` writes operation/sandbox/layout timings; this is an in-process test sandbox and excludes production IPC/render latency. Native interaction coverage remains in `smoke:preview-transitions`.
