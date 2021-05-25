import type { Database } from 'better-sqlite3';
import SqliteDatabase from 'better-sqlite3';

import { join } from 'path';
import { unlink } from 'fs-extra';
import { AckNodesEvent, DiffNode, NodesEvent } from 'trimerge-sync';

type SqliteNodeType = {
  ref: string;
  remoteSyncId: string;
  userId: string;
  clientId: string;
  baseRef?: string;
  mergeRef?: string;
  mergeBaseRef?: string;
  delta?: string;
  editMetadata?: string;
};

export class DocStore<EditMetadata, Delta> {
  private readonly db: Database;
  constructor(
    docId: string,
    baseDir: string = join(__dirname, '..', '_data'),
    private readonly syncIdCreator = () => new Date().toISOString(),
  ) {
    this.db = new SqliteDatabase(join(baseDir, docId + '.sqlite'));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        ref TEXT PRIMARY KEY NOT NULL,
        remoteSyncId INTEGER NOT NULL,
        userId TEXT NOT NULL,
        clientId TEXT NOT NULL,
        baseRef TEXT,
        mergeRef TEXT,
        mergeBaseRef TEXT,
        delta TEXT,
        editMetadata TEXT
      );
`);
  }

  getNodesEvent(lastSyncId?: string): NodesEvent<EditMetadata, Delta, unknown> {
    const stmt =
      lastSyncId === undefined
        ? this.db.prepare(`SELECT * FROM nodes ORDER BY remoteSyncId`)
        : this.db.prepare(
            `SELECT * FROM nodes WHERE remoteSyncId > @lastSyncId ORDER BY remoteSyncId`,
          );

    const sqliteNodes: SqliteNodeType[] = stmt.all({ lastSyncId });
    let syncId = '';
    const nodes = sqliteNodes.map(
      ({
        ref,
        remoteSyncId,
        userId,
        clientId,
        baseRef,
        mergeRef,
        mergeBaseRef,
        delta,
        editMetadata,
      }): DiffNode<EditMetadata, Delta> => {
        if (remoteSyncId > syncId) {
          syncId = remoteSyncId;
        }
        return {
          ref,
          remoteSyncId,
          userId,
          clientId,
          baseRef: baseRef || undefined,
          mergeRef: mergeRef || undefined,
          mergeBaseRef: mergeBaseRef || undefined,
          delta: delta ? JSON.parse(delta) : undefined,
          editMetadata: editMetadata ? JSON.parse(editMetadata) : undefined,
        };
      },
    );
    return {
      type: 'nodes',
      nodes,
      syncId: String(syncId),
    };
  }

  add(nodes: DiffNode<EditMetadata, Delta>[]): AckNodesEvent {
    const remoteSyncId = this.syncIdCreator();
    const insert = this.db.prepare(
      `
        INSERT INTO nodes (ref, remoteSyncId, userId, clientId, baseRef, mergeRef, mergeBaseRef, delta, editMetadata) 
        VALUES (@ref, @remoteSyncId, @userId, @clientId, @baseRef, @mergeRef, @mergeBaseRef, @delta, @editMetadata)`,
    );
    const refs: string[] = [];
    this.db.transaction(() => {
      for (const {
        userId,
        clientId,
        ref,
        baseRef,
        mergeBaseRef,
        mergeRef,
        delta,
        editMetadata,
      } of nodes) {
        insert.run({
          userId,
          clientId,
          ref,
          baseRef,
          mergeBaseRef,
          mergeRef,
          delta: JSON.stringify(delta),
          editMetadata: JSON.stringify(editMetadata),
          remoteSyncId,
        });
        refs.push(ref);
      }
    })();
    return {
      type: 'ack',
      refs,
      syncId: String(remoteSyncId),
    };
  }

  async delete() {
    this.db.close();
    await unlink(this.db.name);
  }
}