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

数据库执行方仍需在提交前核对 current 和完整 revision 集合，在同一事务写入新父关系、载荷及资产引用，
然后才可删除旧行。Host ownership 释放必须有持久重试记录并与新资产接管协调。
上述实际压缩与资产回收尚未启用，基础算法完成不代表可以直接删除现有 revision。

历史列表查询只读取元数据列，不读取再丢弃 checkpoint/patch。
恢复仍走正式编译和新版本提交，不把 current 指针倒回旧版本。

参见 [后端总览](../../README.md)、[Core 历史规则](../../../../../../../src/domains/document-history/README.md)、
[文档类型合同](../../../../../../../docs/plugins/guides/05-document-types.md)。
