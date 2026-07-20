interface AndroidSqliteBridge {
  open(path: string): void;
  exec(sql: string): void;
  query(sql: string, parametersJson: string): string;
  run(sql: string, parametersJson: string): string;
}

declare const AndroidStrippedPloverSqlite: AndroidSqliteBridge;

export interface StatementResultingChanges {
  changes: number;
  lastInsertRowid: number;
}

export class StatementSync {
  constructor(private readonly sql: string) {}

  all(...parameters: unknown[]): Record<string, unknown>[] {
    return JSON.parse(
      AndroidStrippedPloverSqlite.query(this.sql, JSON.stringify(parameters)),
    ) as Record<string, unknown>[];
  }

  get(...parameters: unknown[]): Record<string, unknown> | undefined {
    return this.all(...parameters)[0];
  }

  iterate(...parameters: unknown[]): Iterable<Record<string, unknown>> {
    return this.all(...parameters);
  }

  run(...parameters: unknown[]): StatementResultingChanges {
    return JSON.parse(
      AndroidStrippedPloverSqlite.run(this.sql, JSON.stringify(parameters)),
    ) as StatementResultingChanges;
  }
}

/**
 * Browser-side shape of Node's synchronous SQLite API.
 *
 * All persistence and SQL execution is delegated to Android's private
 * SQLiteDatabase. Statements remain ordinary JavaScript objects so the bridge
 * exposes SQLite operations, not the rest of Stripped Plover's RPC surface.
 */
export class DatabaseSync {
  constructor(path: string) {
    AndroidStrippedPloverSqlite.open(path);
  }

  exec(sql: string): void {
    AndroidStrippedPloverSqlite.exec(sql);
  }

  prepare(sql: string): StatementSync {
    return new StatementSync(sql);
  }
}
