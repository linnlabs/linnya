import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { PluginId } from '@app/schemas';

interface TableNameRow {
  name: string;
}

interface TableColumnRow {
  name: string;
}

interface PluginDataBackupTable {
  readonly sourceTable: string;
  readonly backupTable: string;
  readonly columns: readonly string[];
}

export interface PluginDataBackupToken {
  readonly token: string;
  readonly pluginId: PluginId;
  readonly tables: readonly PluginDataBackupTable[];
}

export class PluginDataBackup {
  constructor(private readonly db: Database.Database) {}

  snapshot(pluginId: PluginId, ownedTables: readonly string[]): PluginDataBackupToken {
    const token = createBackupToken();
    if (ownedTables.length === 0) {
      return { token, pluginId, tables: [] };
    }

    for (const sourceTable of ownedTables) {
      assertSqliteIdentifier(sourceTable, 'owned table');
      if (!this.tableExists(sourceTable)) {
        throw new Error(`插件 ownedTables 声明的表不存在: ${pluginId}/${sourceTable}`);
      }
    }

    const tables: PluginDataBackupTable[] = [];
    for (const sourceTable of ownedTables) {
      const backupTable = `__backup_${token}_${sourceTable}`;
      assertSqliteIdentifier(backupTable, 'backup table');
      const columns = this.readTableColumns(sourceTable);
      this.db.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(backupTable)}`);
      this.db.exec(`
        CREATE TABLE ${quoteIdentifier(backupTable)}
        AS SELECT * FROM ${quoteIdentifier(sourceTable)}
      `);
      tables.push({ sourceTable, backupTable, columns });
    }

    return { token, pluginId, tables };
  }

  restore(snapshot: PluginDataBackupToken): void {
    // 中文说明：按 manifest ownedTables 的反序删除、正序插入，尽量避开简单父子表外键顺序问题。
    for (let index = snapshot.tables.length - 1; index >= 0; index -= 1) {
      const table = snapshot.tables[index];
      if (!table) continue;
      this.assertSnapshotTableAvailable(table);
      this.db.exec(`DELETE FROM ${quoteIdentifier(table.sourceTable)}`);
    }

    for (const table of snapshot.tables) {
      this.assertSnapshotTableAvailable(table);
      const columnList = table.columns.map(quoteIdentifier).join(', ');
      this.db.exec(`
        INSERT INTO ${quoteIdentifier(table.sourceTable)} (${columnList})
        SELECT ${columnList}
        FROM ${quoteIdentifier(table.backupTable)}
      `);
    }
  }

  discard(snapshot: PluginDataBackupToken): void {
    for (const table of snapshot.tables) {
      assertSqliteIdentifier(table.backupTable, 'backup table');
      this.db.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(table.backupTable)}`);
    }
  }

  private assertSnapshotTableAvailable(table: PluginDataBackupTable): void {
    assertSqliteIdentifier(table.sourceTable, 'source table');
    assertSqliteIdentifier(table.backupTable, 'backup table');
    if (!this.tableExists(table.sourceTable)) {
      throw new Error(`插件数据恢复失败，源表不存在: ${table.sourceTable}`);
    }
    if (!this.tableExists(table.backupTable)) {
      throw new Error(`插件数据恢复失败，备份表不存在: ${table.backupTable}`);
    }
  }

  private tableExists(tableName: string): boolean {
    const row = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName) as TableNameRow | undefined;
    return !!row;
  }

  private readTableColumns(tableName: string): string[] {
    const rows = this.db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all() as TableColumnRow[];
    return rows.map((row) => row.name);
  }
}

function createBackupToken(): string {
  return `${Date.now().toString(36)}_${randomUUID().replace(/-/g, '')}`;
}

function assertSqliteIdentifier(identifier: string, label: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`非法 SQLite ${label} 标识符: ${identifier}`);
  }
}

function quoteIdentifier(identifier: string): string {
  assertSqliteIdentifier(identifier, 'quoted');
  return `"${identifier}"`;
}
