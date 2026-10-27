/** 删除、迁移或当前作用域不可见的文档是业务失效；数据库/编程错误仍向上传播。 */
export class DocumentObservationUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = 'DocumentObservationUnavailableError'; }
}
