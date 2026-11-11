# 只读源码质量盘点

从仓库根运行
`pnpm exec tsx scripts/diagnostics/code-quality/auditRepository.ts`，stdout 是 JSON，可重定向到系统临时目录。命令不修改源码、基线、Git
index 或运行数据。

它盘点 Git 已跟踪及未忽略的候选源码，明确列出排除项，已从工作区删除的跟踪文件不读取；目前排除退役 Mindmap、WASM 生成绑定、标记的生成文件及第三方原件。生产代码、测试、开发脚本、声明分别统计。CSS、Rust、PowerShell 等只计文件与行数，JS/TS 与 Vue 的 script 另使用已有 TypeScript
/ Vue parser 提取函数及语法线索。所有位置使用原文件行号。

输出包含函数名、范围、异步标记、函数体 token
hash，以及 store 内异步函数、异步 forEach、async Promise
executor、同步 I/O、空 catch、显式 any、双重断言、原始错误转文字、格式化与全局点击监听的位置。hash 忽略注释与空白，保留标识符、字面量和运算符；相同函数体不代表参数、闭包、默认值或业务规则相同。

这是审计索引，不是违规判决或门禁。统计会包含合法的同步启动、同步事务、清理 catch 和技术事件监听；必须读 owner 合同与调用链后才能判断。它不尝试证明异步安全、解析依赖图或自动合并代码。大段/改名相似代码用专门的 clone
detector，模块依赖用专门的 dependency
analyzer；记录工具版本、配置、范围、未解析项及人工复核结论，不能把工具命中数直接当问题数。

Vue SFC 解析失败另列在
`parseErrors`，不能把缺失 script 的 Vue 空壳算成已通过语法检查。TypeScript
AST 允许语法恢复；此工具不替代编译器的语法或类型检查。

整改与共享位置遵循
[代码质量规范](../../../../docs/development/code-quality.md)。审计过程记录不进入公共仓；公共文档只维护可复用方法和已确认的合同。
