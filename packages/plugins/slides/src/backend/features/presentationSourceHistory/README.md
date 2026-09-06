# Presentation source history

成功版本保存 deck.js 的 checkpoint/patch，当前文稿单独保存最新物化结果。失败 draft 不是成功历史。
本 feature 拥有源码编码、重放、稀疏链计划与恢复编排；仓储拥有 SQL，Core 拥有时间保留规则。

## 链不变量

- revisionId 是不可变身份，revision 是严格递增的序号；允许序号有空洞，不重新编号。
- parentRevisionId 指向实际前一个保留版本，不通过 revision 减一推断。
- 全链首个版本必须是自包含 checkpoint；局部读取可从中途 checkpoint 开始，不要求加载其父源码。
- 同一次重放中，checkpoint 和 patch 均验证父身份、base hash 与 source hash。
- patch 不划算、累计 patch 达到源码体积或到达定期 checkpoint 时，继续复用同一编码规则。

## 稀疏重链

`planPresentationSourceCompaction` 单次重放原链，校验所有源码（包括待删除版本），只保存保留点的新载荷。
最旧保留点变成 checkpoint，后续点相对上一个实际保留点编码。源码 hash 和版本身份保持不变。
计划不执行 SQL，不处理图片，不发布文档更新。调用方必须先合并 current 和 draft base 等必保依赖。

`PresentationHistoryRuntime` 在成功提交后按文稿串行、合并重复维护请求。失败只记诊断，不回滚成功保存，
下一次成功提交会再尝试；只打开历史面板不触发压缩。维护与正式编译共用文稿级执行作用域。
仓储提交前再次核对 current、完整 revision 身份集合和 draft 身份，在同一即时事务写入新链、资产引用和删除旧行。
draft base 必保；存在失败草稿时仍可压缩源码，但暂停资产释放，避免删除草稿尚未形成成功引用的图片。

## 版本上下文与资产

每次成功提交同时保存源码执行时实际注入的主题和采用的 image/SVG asset IDs，失败构建不产生成功引用。
主题来自编译输入，而不是输出 DeckSpec.theme：源码可能一边引用旧 DECK_DESIGN、一边输出新主题，二者不能混为一谈。
`presentation_revision_contexts` 保存主题，`presentation_revision_assets` 保存轻量引用，均随 revision 删除。
旧版本缺少引用时，对所有保留点只读重建，全部成功才执行压缩；不从当前文稿借用主题。
旧源码依赖已丢失的隐式主题或资源时，无法凭空恢复：报告维护失败并保留历史，而不是猜测后删除。

不再可达的 binding 与 `presentation_asset_releases` 待释放记录同事务更新；Host 门面只解除精确文稿归属，
物理字节仍由既有 Asset GC 处理。失败后待释放记录保留，下次维护重试；若资产已被后续版本重新使用则撤销释放。
其他文档、项目或会话仍引用的图片不会被此次释放删除。Brush 同样复用图片资产链，不另存历史位图。

历史列表查询只读取元数据列，不读取再丢弃 checkpoint/patch。
恢复只有统一 history 入口：请求带目标 versionId 和 expectedCurrentVersionId，编译前与提交时均校验 current。
恢复使用该历史版本主题、只读资产解析及正式编译链，随后新建 origin=restore 的成功版本、清除旧 draft，
同步更新 VFS 文本快照并发布标准 workspace.document.updated；不把 current 指针倒回旧版本。
恢复来源的版本 ID 与时间随新 revision 同事务保存，不设来源外键，避免阻止旧版本清理；来源被清理后仍能显示原时间。
连续恢复记录本次实际选择的来源，不追溯替换成更早来源；普通提交不继承。v7 补齐列，未记录来源的旧恢复不猜测回填。
旧的仅凭 revision 数字恢复入口已移除，避免绕过冲突检查或借用当前主题。

## 只读预览

插件私有 `slides:history-preview` 重建源码并返回既有 RenderModel，不写当前物化、PPTX、截图缓存或文档事件。
图片和 SVG 只能从既有绑定读取，不能下载、重新生成 Brush 或重新接管文件。当前编译器升级可能改变历史视觉，
历史承诺是源码与已拥有资源，不是冻结旧版渲染引擎的像素快照。
前端仅保留一个历史 RenderModel 和选中页的一张 bitmap；切页/关闭取消栅格请求并释放 bitmap，
后端已发出的 IPC 编译结果在关闭后丢弃。详见 [只读预览](../../../renderer/features/presentationHistory/README.md)。

参见 [后端总览](../../README.md)、[Core 历史规则](../../../../../../../src/domains/document-history/README.md)、
[文档类型合同](../../../../../../../docs/plugins/guides/05-document-types.md)。
