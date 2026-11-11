# 公式块与内联公式

公式编辑状态由 `store/latexEditor.js` 持有，公开类型在 `definitions/latexEditor.ts`。`runtime.ts` 装配提交事务和延迟清理流程；store 仅暴露同步动作和读取编辑器的方法，不派发编辑器事务。

`functions/isLatexSourceValid.ts` 使用与显示相同的 KaTeX 规则校验源码。提交必须针对当前 NodeSelection 中同一 ID 的公式节点，单个事务更新源码并移动光标。面板调用方等待提交结果后决定焦点；隐藏/取消保留原有 10ms 清理节奏和取消源码语义。
