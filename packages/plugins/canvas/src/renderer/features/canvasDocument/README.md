# Canvas 文档会话

`createCanvasDocumentSession` 是公开会话入口，拥有文档打开/关闭世代、订阅和视图身份。
`createCanvasViewRequests` 串行安排 Host 视图请求；先订阅再读快照，关闭会等待在途视图请求和声明释放，旧打开结果不能覆盖新会话。

增量追平由 `createCanvasDocumentSynchronization` 拥有目标序列和单个在途读取，安装前后都核对会话世代。写入由 `createCanvasDocumentMutations` 组合确认队列、正式提交和撤销；请求身份在首次发送前固定，投递重试只确认原请求，不能生成第二次业务操作。两者只通过会话世代和追平能力协作，不反向打开或关闭视图。

`createCanvasEditingClaims` 统一持有字段声明和续约。切换/关闭先失效本地会话，再清理声明、确认队列和投影；迟到结果不能重新装入旧文档。Store 仅持有正式投影、阶段及错误，增量计算在 functions 中完成。
