# Presentation Layout Refresh

该 feature 让已存生成稿的当前物化跟上排版合同。

- `presentation_documents.deck_spec_json` 是 current revision 从 `deckSource` 编译出的物化；修订表只存源码。排版规则变化（如 2026-11-16 单倍行距改为 1.2 倍字号）后，旧物化里的自动高度外框仍按旧规则算出，直接读取会溢出。
- 版本只定义在 `shared/deckSpec/deckLayoutVersion.ts` 的 `DECK_LAYOUT_VERSION`，由 `CodegenDeckBuilder` 写入 `DeckSpec.layoutVersion`。改变同一源码编译出的外框时，在那里加一并写明原因。
- `PresentationQueryRuntime` 的画布视图、预览、渲染模型、inspect 与导出入口先调用 `ensureCurrent`：只读 revision 与版本号；落后时用同一份源码和原主题重编译，经 `refreshPresentationDeckSpec` 按 current revision CAS 写回，并作废该 revision 的 PPTX 缓存。
- 刷新不产生用户修订、不改源码、不进撤销历史。CAS 落空说明 current 已前进，新 revision 由正式编译产生。
- 源码已无法编译时只记 `slides.layout_refresh.failed`，沿用旧物化，同一 revision 在进程内不再重试。
- 人工编辑入口遇到旧物化同样先重编译（与 `authoringIdentityVersion` 旧稿同一处），保证编辑基线与画面一致。

## 验证

`orchestration/PresentationLayoutRefreshRuntime.test.ts` 覆盖跳过、单次重编译与失败不重试；`persistence/presentation-repository.test.ts` 覆盖 CAS、PPTX 作废与不追加 revision；`__tests__/manual-edit-save-reopen.integration.test.ts` 确认连续编辑后版本号保留。
