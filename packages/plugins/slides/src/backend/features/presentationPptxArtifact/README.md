# Presentation PPTX Artifact

该 feature 拥有 generated Slides 当前 revision 的 PPTX 派生 artifact。

- 语义 revision 的事实是 `deckSource + DeckSpec`。
- `pptx_revision_id` 只有与 `current_revision_id` 相等时，BLOB 才可读取。
- 缺失 artifact 由导出或依赖 package 的查询按需物化，并通过 revision CAS 附着。
- 同一进程内相同 revision 的并发请求共享一次物化；交互提交不启动后台 PPTX 作业。
- v9 迁移同时为尚无 history context 的旧 current revision 回填主题和现有 asset binding，保证升级后的首次人工编辑可以严格继承资产可达性。

这条边界让画布更新不再等待 ZIP/XML/PPTX 写出，也避免后台物化与交互编译争用单 worker。
