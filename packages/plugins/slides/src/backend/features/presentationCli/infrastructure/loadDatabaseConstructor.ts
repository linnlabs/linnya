import Database from 'better-sqlite3';

/**
 * 把原生模块加载延迟到真正执行查询的分支，help 与参数错误不触碰数据库运行时。
 * packaged command 的宿主依赖解析由 commands domain 统一负责，插件不感知 app 布局。
 */
export function getSlidesCliDatabaseConstructor(): typeof Database {
  return Database;
}
