---
name: canvas
description: Read, edit, arrange, inspect and render Linnya .canvas documents through the managed Canvas CLI. Use for free canvas, card diagrams, mindmaps, project overviews and canvas editing.
metadata:
  author: linnya
  pluginId: canvas
  version: "1"
---

# Canvas

这是 Linnya 自由画布，**不是 JSON Canvas**。当前内容是逐元素事实，不能用 write_file/edit_file 覆盖 .canvas 投影。

## 入口与权限

- 只使用既有 read_file、write_file、shell、process、skill；没有 Canvas 专属模型工具。
- 使用 `linnya-canvas`；它是当前 App 受管 Shell 的插件命令，不是普通终端的连接入口。
- 创建输入文件及 apply、arrange、render 的 shell 调用必须设置 `requires_write_access: true`。
- 查询使用 `workspace:/目录/文件.canvas`。操作 JSON、图片输入使用当前会话相对路径或 `conversation:/`。
- `write_file`只写Workspace文档，不创建会话物理文件。Workspace与Shell工作目录不自动同步，不能把虚拟路径当作已存在的输入文件。
- 不传数据库路径、项目ID、对话ID、批准标志、任意输出目录。身份与权限由 Host 提供。
- Shell 返回 completed 仍须检查 `data.terminal.process_exit`；0 为成功，8 为 Canvas 参数或业务错误。
- stdout 只有 JSON。长命令若返回 process handle，用 process 等待；不要重复发新写请求。
- apply、arrange及其dry-run的完整JSON响应是逐项判断与修正的依据。不要先用管道过滤stdout；需要摘要时先保留完整响应，再解释结果。失败响应也要保留，不能只记录成功回执。

## 推荐流程

1. read_file 读取画布概览；或 `linnya-canvas read workspace:/讨论.canvas`。
2. 全文修改前用 `show <画布路径> <cN>` 读取目标卡，记住其 revision。大画布概览会截断正文。
3. 用 shell 在默认的本次对话物理工作目录创建 UTF-8 JSON 操作数组，按当前终端支持的写文件语法保存，再调用 apply。每批最多500个原始动作。
4. 检查每项 applied/skipped 与原因。被锁定、正在编辑或字段版本过期的内容会保留。
5. 必要时 check 检查重叠、交叉与离群；render 查看真实画面。不要把启发提示当成事实错误。

## 写入

`linnya-canvas apply workspace:/讨论.canvas --ops-file batch.json --request-id action-001`

- 每个逻辑写动作使用新的 request-id；响应丢失的重试复用原ID与原始数组。
- 不同ID的相同新增内容会创建不同卡，程序不会按正文猜重复。
- 若输出经过管道筛选或响应丢失，用`receipt <画布路径> <原request-id>`只读查询原始回执；不要换新ID再写一次来猜是否成功。提交回执保留逐项结果，不能用当前画面代替；查不到回执也不能证明原请求未尝试或未失败。
- `--dry-run` 校验、真实测高并给出预测，不写入；正式ID与位置以提交回执为准。
- 新卡用 `$name` 临时ref互相引用，提交后用回执refs取得真实cN/eN。不要猜下一个ID。
- 文字写Markdown；只选颜色white/red/orange/yellow/green/cyan/purple；不写坐标、字体或色值。
- 新增只找空位，不挪动既有卡。near/after/in用于附近定位，side可right/left/top/bottom。
- parentId预留分组，**不是树父子**。树父子通过connect表达。
- update必须带show读到的revision；text替换全文，append只追加新Markdown块并保留原节点。
- 文档卡用type=document及document=workspace:路径；图片卡用type=image及file=会话文件。
- 行内图片可引用会话文件；远程图先下载到会话目录。CLI不自行联网。
- 文档标签用标准Markdown链接，例如`[资料](workspace:/资料.md)`；提交时转换成稳定身份。
- 读取后引用目标改名、移动或同路径被替换会拒绝旧写；重新show后重试。
- 含失效/越界标签的全文替换不能无损完成，会明确拒绝；可append，或先在界面处理引用。
- delete/disconnect使用本画布cN/eN；不能跨画布引用这些局部编号。

具体数组见 [操作与示例](references/operations.md)；可直接解析的示例在 [examples.json](references/examples.json)。

## 排布

`linnya-canvas arrange workspace:/讨论.canvas --request-id layout-001 --algorithm tree --scope c1,c2,c3`

- tree生成树状投影；多父或环按先到父节点排，其余线保留并报告。复杂依赖用layered。
- grid支持`--columns 3`；layered使用ELK分层。方向为`--direction right|down`。
- 未指定scope代表整张画布。整理新增卡时明确写它们的ref/ID，避免挪动原卡。
- apply末尾也可放一个arrange，elementIds可含本批ref；新增、连接与排布仍一次原子提交。
- groups可把多个集合分开排，不建立二阶段的分组实体。锁定/编辑中的位置不会被挪动。

## 用户确认与撤回

- 改动按“对话×画布”累计成组，子Agent共享组；run结束不结束组。
- 累计删除用户创建的卡达到20张，或排布移动至少20张且覆盖其九成，会返回pending。
- pending代表**尚未执行**。回复提醒用户在画布点允许或不允许；不能自行批准或换命令绕过。
- groups可查询本对话审批结果。被拒绝、替换或过期的请求不能直接重放为新写入。
- 用户可在画布撤回整组或部分卡；其他来源的后续改动会被保留。

## 查询与图像

- `show <画布路径> <cN|eN>`：单卡全文/线属性。
- `find <画布路径> <文字>`：按当前正文与可访问标题搜索。
- `neighbors <画布路径> <cN> --depth 2`：相邻卡与连接。
- `region <画布路径> 左上`：九宫格区域；也支持上方/右上/左侧/正中/右侧/左下/下方/右下。
- `check <画布路径>`：共享正式曲线几何的检查；不移动任何卡。
- `receipt <画布路径> <request-id>`：只读查询当前对话的持久回执，含pending/committed/denied等状态；未找到返回null，不触发提交或批准。
- `render <画布路径> --format png --width 1440 --height 900 --theme light`：返回单次提交版本的图像locator。
- render在画布未打开时也可运行；用read_file读取返回的conversation:图像，不传图片inode或字符窗口。
- 图片/文档封面不可用时会明确报告。画布中的画布卡只显示身份牌，避免递归展开。
