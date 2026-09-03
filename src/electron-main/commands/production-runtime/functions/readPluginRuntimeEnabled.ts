import Database from 'better-sqlite3';

interface InstalledPluginRow {
  readonly installed: number;
}

export function readPluginRuntimeEnabled(input: {
  readonly databasePath: string;
  readonly pluginId: string;
}): boolean {
  let database: Database.Database | undefined;
  try {
    database = new Database(input.databasePath, {
      readonly: true,
      fileMustExist: true,
    });
    const installed = database
      .prepare<[string], InstalledPluginRow>(
        'SELECT installed FROM installed_plugins WHERE plugin_id = ?',
      )
      .get(input.pluginId);
    if (!installed || installed.installed !== 1) return false;
    return Boolean(database
      .prepare<[string], { readonly plugin_id: string }>(
        'SELECT plugin_id FROM enabled_plugins WHERE plugin_id = ?',
      )
      .get(input.pluginId));
  } catch {
    return false;
  } finally {
    database?.close();
  }
}
