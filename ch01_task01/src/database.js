import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA_VERSION = 1;

export function openDatabase(filename = ':memory:') {
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new TypeError('Database filename must be a non-empty string');
  }
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });

  const database = new DatabaseSync(filename);
  try {
    database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (filename !== ':memory:') database.exec('PRAGMA journal_mode = WAL;');

    // Check the version while holding the write lock, including during first startup.
    database.exec('BEGIN IMMEDIATE');
    try {
      const { user_version: version } = database.prepare('PRAGMA user_version').get();
      if (version > SCHEMA_VERSION) {
        throw new Error(`Database schema ${version} is newer than supported schema ${SCHEMA_VERSION}`);
      }
      if (version === 0) {
        const migration = readFileSync(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8');
        database.exec(migration);
        database.exec('PRAGMA user_version = 1');
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
