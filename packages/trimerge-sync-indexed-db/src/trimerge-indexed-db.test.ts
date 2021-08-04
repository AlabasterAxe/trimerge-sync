import 'fake-indexeddb/auto';

import { GetRemoteFn, TrimergeClient } from 'trimerge-sync';
import {
  createIndexedDbBackendFactory,
  deleteDocDatabase,
  resetDocRemoteSyncData,
} from './trimerge-indexed-db';
import { differ } from './testLib/BasicDiffer';
import { timeout } from './lib/timeout';
import { getMockRemote } from './testLib/MockRemote';
import { dumpDatabase, getIdbDatabases } from './testLib/IndexedDB';

function makeTestClient(
  userId: string,
  clientId: string,
  docId: string,
  storeId: string,
  getRemote?: GetRemoteFn<any, any, any>,
) {
  return new TrimergeClient<any, any, any, any>(
    userId,
    clientId,
    createIndexedDbBackendFactory(docId, {
      localIdGenerator: () => storeId,
      getRemote,
      networkSettings: {
        initialDelayMs: 0,
        reconnectBackoffMultiplier: 1,
        maxReconnectDelayMs: 0,
        electionTimeoutMs: 0,
        heartbeatIntervalMs: 10,
        heartbeatTimeoutMs: 50,
      },
    }),
    differ,
    0,
  );
}

beforeEach(() => {
  // override readonly status
  global.indexedDB! = new IDBFactory();
});

describe('createIndexedDbBackendFactory', () => {
  it('creates indexed db', async () => {
    const docId = 'test-doc-create';
    const client = makeTestClient('test', '1', docId, 'test-doc-store');
    client.updateState('hello', '');
    client.updateState('hello there', '');

    // Wait for write
    await timeout(100);
    await client.shutdown();

    await expect(dumpDatabase(docId)).resolves.toMatchInlineSnapshot(`
      Object {
        "heads": Array [
          Object {
            "ref": "r4VLd8ne",
          },
        ],
        "nodes": Array [
          Object {
            "baseRef": undefined,
            "clientId": "1",
            "delta": Array [
              "hello",
            ],
            "editMetadata": "",
            "mergeBaseRef": undefined,
            "mergeRef": undefined,
            "ref": "W04IBhus",
            "remoteSyncId": "",
            "syncId": 1,
            "userId": "test",
          },
          Object {
            "baseRef": "W04IBhus",
            "clientId": "1",
            "delta": Array [
              "hello",
              "hello there",
            ],
            "editMetadata": "",
            "mergeBaseRef": undefined,
            "mergeRef": undefined,
            "ref": "r4VLd8ne",
            "remoteSyncId": "",
            "syncId": 2,
            "userId": "test",
          },
        ],
        "remotes": Array [],
      }
    `);
  });

  it('creates indexed db and can read it', async () => {
    const docId = 'test-doc-read';
    const client = makeTestClient('test', '1', docId, 'test-doc-store');
    client.updateState('hello', '');
    client.updateState('hello there', '');
    client.updateState('hello world', '');
    // Wait for write
    await timeout(100);
    await client.shutdown();

    // Wait for idb to settle down
    await timeout(100);

    const client2 = makeTestClient('test', '2', docId, 'test-doc-store');

    // Wait for read
    await timeout(100);
    expect(client2.state).toEqual('hello world');

    await client2.shutdown();
  });

  it('collaboration works', async () => {
    const docId = 'test-doc-collab';
    const client1 = makeTestClient('test', '1', docId, 'test-doc-store');
    client1.updateState('hello', '');
    client1.updateState('hello world', '');
    // Wait for write
    await timeout(100);

    const client2 = makeTestClient('test', '2', docId, 'test-doc-store');

    // Wait for read
    await timeout(100);
    expect(client2.state).toEqual('hello world');

    client1.updateState('hello there', '');
    await timeout();
    client2.updateState('oh hello', '');

    // Wait for read
    await timeout(100);
    expect(client1.state).toEqual('oh hello there');
    expect(client2.state).toEqual('oh hello there');

    await client1.shutdown();
    await client2.shutdown();

    await expect(dumpDatabase(docId)).resolves.toMatchInlineSnapshot(`
      Object {
        "heads": Array [
          Object {
            "ref": "3vmxbFmH",
          },
        ],
        "nodes": Array [
          Object {
            "baseRef": "JvrfzM9e",
            "clientId": "2",
            "delta": Array [
              "hello there",
              "oh hello there",
            ],
            "editMetadata": Object {
              "message": "merge",
              "ref": "(JvrfzM9e+Rofed6go)",
            },
            "mergeBaseRef": "GhP0VPg5",
            "mergeRef": "Rofed6go",
            "ref": "3vmxbFmH",
            "remoteSyncId": "",
            "syncId": 5,
            "userId": "test",
          },
          Object {
            "baseRef": "W04IBhus",
            "clientId": "1",
            "delta": Array [
              "hello",
              "hello world",
            ],
            "editMetadata": "",
            "mergeBaseRef": undefined,
            "mergeRef": undefined,
            "ref": "GhP0VPg5",
            "remoteSyncId": "",
            "syncId": 2,
            "userId": "test",
          },
          Object {
            "baseRef": "GhP0VPg5",
            "clientId": "1",
            "delta": Array [
              "hello world",
              "hello there",
            ],
            "editMetadata": "",
            "mergeBaseRef": undefined,
            "mergeRef": undefined,
            "ref": "JvrfzM9e",
            "remoteSyncId": "",
            "syncId": 3,
            "userId": "test",
          },
          Object {
            "baseRef": "GhP0VPg5",
            "clientId": "2",
            "delta": Array [
              "hello world",
              "oh hello",
            ],
            "editMetadata": "",
            "mergeBaseRef": undefined,
            "mergeRef": undefined,
            "ref": "Rofed6go",
            "remoteSyncId": "",
            "syncId": 4,
            "userId": "test",
          },
          Object {
            "baseRef": undefined,
            "clientId": "1",
            "delta": Array [
              "hello",
            ],
            "editMetadata": "",
            "mergeBaseRef": undefined,
            "mergeRef": undefined,
            "ref": "W04IBhus",
            "remoteSyncId": "",
            "syncId": 1,
            "userId": "test",
          },
        ],
        "remotes": Array [],
      }
    `);
  });

  it('deletes indexed db with deleteDocDatabase', async () => {
    const docId = 'test-doc-delete';
    const client1 = makeTestClient('test', '1', docId, 'test-doc-store');
    client1.updateState('hello world', '');
    // Wait for write
    await timeout(1000);
    await client1.shutdown();

    await expect(getIdbDatabases()).resolves.toMatchInlineSnapshot(`
      Array [
        Object {
          "name": "trimerge-sync:test-doc-delete",
          "version": 2,
        },
      ]
    `);

    await deleteDocDatabase(docId);

    await expect(getIdbDatabases()).resolves.toHaveLength(0);
  });

  it('works with remote', async () => {
    const docId = 'test-doc-remote';
    const client1 = makeTestClient(
      'test',
      '1',
      docId,
      'test-doc-store',
      getMockRemote,
    );
    client1.updateState('hello remote', '');
    // Wait for write
    await timeout(100);
    await client1.shutdown();

    const client2 = makeTestClient(
      'test',
      '2',
      docId,
      'test-doc-store',
      getMockRemote,
    );
    // Wait for write
    await timeout(100);
    expect(client2.state).toEqual('hello remote');
    await client2.shutdown();
  });

  it('resets remote data', async () => {
    const docId = 'test-doc-reset-remote';
    const client1 = makeTestClient(
      'test',
      '1',
      docId,
      'test-doc-store',
      getMockRemote,
    );
    client1.updateState('hello remote', '');
    // Wait for write
    await timeout(100);
    await client1.shutdown();

    await expect(dumpDatabase(docId)).resolves.toMatchInlineSnapshot(`
      Object {
        "heads": Array [
          Object {
            "ref": "lIKnl-vc",
          },
        ],
        "nodes": Array [
          Object {
            "baseRef": undefined,
            "clientId": "1",
            "delta": Array [
              "hello remote",
            ],
            "editMetadata": "",
            "mergeBaseRef": undefined,
            "mergeRef": undefined,
            "ref": "lIKnl-vc",
            "remoteSyncId": "foo",
            "syncId": 1,
            "userId": "test",
          },
        ],
        "remotes": Array [
          Object {
            "lastSyncCursor": "foo",
            "localStoreId": "test-doc-store",
          },
        ],
      }
    `);
    await resetDocRemoteSyncData(docId);
    await expect(dumpDatabase(docId)).resolves.toMatchInlineSnapshot(`
      Object {
        "heads": Array [
          Object {
            "ref": "lIKnl-vc",
          },
        ],
        "nodes": Array [
          Object {
            "baseRef": undefined,
            "clientId": "1",
            "delta": Array [
              "hello remote",
            ],
            "editMetadata": "",
            "mergeBaseRef": undefined,
            "mergeRef": undefined,
            "ref": "lIKnl-vc",
            "remoteSyncId": "",
            "syncId": 1,
            "userId": "test",
          },
        ],
        "remotes": Array [],
      }
    `);

    const client2 = makeTestClient(
      'test',
      '2',
      docId,
      'test-doc-store',
      getMockRemote,
    );
    // Wait for write
    await timeout(100);
    expect(client2.state).toEqual('hello remote');
    await client2.shutdown();
    await expect(dumpDatabase(docId)).resolves.toMatchInlineSnapshot(`
      Object {
        "heads": Array [
          Object {
            "ref": "lIKnl-vc",
          },
        ],
        "nodes": Array [
          Object {
            "baseRef": undefined,
            "clientId": "1",
            "delta": Array [
              "hello remote",
            ],
            "editMetadata": "",
            "mergeBaseRef": undefined,
            "mergeRef": undefined,
            "ref": "lIKnl-vc",
            "remoteSyncId": "foo",
            "syncId": 1,
            "userId": "test",
          },
        ],
        "remotes": Array [
          Object {
            "lastSyncCursor": "foo",
            "localStoreId": "test-doc-store",
          },
        ],
      }
    `);
  });

  it('works offline then with remote', async () => {
    const docId = 'test-doc-remote2';
    const client = makeTestClient('test', '1', docId, 'test-doc-store');
    client.updateState('hello offline remote', '');
    // Wait for write
    await timeout(100);
    await client.shutdown();

    const client2 = makeTestClient(
      'test',
      '2',
      docId,
      'test-doc-store',
      getMockRemote,
    );
    // Wait for write
    await timeout(100);
    expect(client2.state).toEqual('hello offline remote');

    client2.updateState('hello online remote', '');
    await timeout(100);

    await client2.shutdown();

    await expect(dumpDatabase(docId)).resolves.toMatchInlineSnapshot(`
      Object {
        "heads": Array [
          Object {
            "ref": "_btn0pve",
          },
        ],
        "nodes": Array [
          Object {
            "baseRef": "axg0ZCUR",
            "clientId": "2",
            "delta": Array [
              "hello offline remote",
              "hello online remote",
            ],
            "editMetadata": "",
            "mergeBaseRef": undefined,
            "mergeRef": undefined,
            "ref": "_btn0pve",
            "remoteSyncId": "foo",
            "syncId": 2,
            "userId": "test",
          },
          Object {
            "baseRef": undefined,
            "clientId": "1",
            "delta": Array [
              "hello offline remote",
            ],
            "editMetadata": "",
            "mergeBaseRef": undefined,
            "mergeRef": undefined,
            "ref": "axg0ZCUR",
            "remoteSyncId": "foo",
            "syncId": 1,
            "userId": "test",
          },
        ],
        "remotes": Array [
          Object {
            "lastSyncCursor": "foo",
            "localStoreId": "test-doc-store",
          },
        ],
      }
    `);
  });
});