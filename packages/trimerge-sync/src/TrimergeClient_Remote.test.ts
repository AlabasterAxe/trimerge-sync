import { computeRef, diff, merge, migrate, patch } from './testLib/MergeUtils';
import { Differ } from './differ';
import { MemoryStore } from './testLib/MemoryStore';
import { Delta } from 'jsondiffpatch';
import { TrimergeClient } from './TrimergeClient';
import { getBasicGraph } from './testLib/GraphVisualizers';
import { SyncStatus } from './types';
import { timeout } from './lib/Timeout';
import { resetAll } from './testLib/MemoryBroadcastChannel';

type TestEditMetadata = string;
type TestSavedDoc = any;
type TestDoc = any;
type TestPresence = any;

const differ: Differ<TestSavedDoc, TestDoc, TestEditMetadata, TestPresence> = {
  migrate,
  diff,
  patch,
  computeRef,
  merge,
};

const stores = new Set<MemoryStore<TestEditMetadata, Delta, TestPresence>>();

afterEach(async () => {
  for (const store of stores) {
    await store.shutdown();
  }
  stores.clear();
  resetAll();
});

function newStore(
  remote?: MemoryStore<TestEditMetadata, Delta, TestPresence>,
  online?: boolean,
) {
  const store = new MemoryStore<TestEditMetadata, Delta, TestPresence>(
    undefined,
    remote?.getRemote,
    online,
  );
  stores.add(store);
  return store;
}

function makeClient(
  userId: string,
  clientId: string,
  store: MemoryStore<TestEditMetadata, Delta, TestPresence>,
): TrimergeClient<
  TestSavedDoc,
  TestDoc,
  TestEditMetadata,
  Delta,
  TestPresence
> {
  return new TrimergeClient(userId, clientId, store.getLocalStore, differ, 0);
}

function basicGraph(
  store: MemoryStore<TestEditMetadata, Delta, TestPresence>,
  client1: TrimergeClient<
    TestSavedDoc,
    TestDoc,
    TestEditMetadata,
    Delta,
    TestPresence
  >,
) {
  return getBasicGraph(
    store.getCommits(),
    (commit) => commit.editMetadata,
    (commit) => client1.getCommitDoc(commit.ref).doc,
  );
}

function basicClients(
  client1: TrimergeClient<
    TestSavedDoc,
    TestDoc,
    TestEditMetadata,
    Delta,
    TestPresence
  >,
): Record<string, TestPresence> {
  const obj: Record<string, TestPresence> = {};
  for (const client of client1.clients) {
    obj[`${client.userId}:${client.clientId}`] = client.presence;
  }
  return obj;
}

function newRemoteStore(online?: boolean) {
  return newStore(undefined, online);
}

describe('Remote sync', () => {
  it('syncs one client to a remote', async () => {
    const remoteStore = newStore();
    const localStore = newStore(remoteStore);
    const client = makeClient('a', 'test', localStore);

    const syncUpdates: SyncStatus[] = [];
    client.subscribeSyncStatus((state) => syncUpdates.push(state));

    client.updateDoc({}, 'initialize');
    client.updateDoc({ hello: 'world' }, 'add hello');

    await timeout();

    const localGraph1 = basicGraph(localStore, client);
    const remoteGraph1 = basicGraph(remoteStore, client);
    expect(remoteGraph1).toEqual(localGraph1);
    expect(localGraph1).toMatchInlineSnapshot(`
      Array [
        Object {
          "graph": "undefined -> DuQe--Vh",
          "step": "User a: initialize",
          "value": Object {},
        },
        Object {
          "graph": "DuQe--Vh -> u0wBto6f",
          "step": "User a: add hello",
          "value": Object {
            "hello": "world",
          },
        },
      ]
    `);
    expect(syncUpdates).toMatchInlineSnapshot(`
Array [
  Object {
    "localRead": "loading",
    "localSave": "ready",
    "remoteConnect": "offline",
    "remoteRead": "offline",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "loading",
    "localSave": "pending",
    "remoteConnect": "offline",
    "remoteRead": "offline",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "pending",
    "remoteConnect": "offline",
    "remoteRead": "offline",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "pending",
    "remoteConnect": "connecting",
    "remoteRead": "loading",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "pending",
    "remoteConnect": "online",
    "remoteRead": "loading",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "pending",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "saving",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "saving",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "pending",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "pending",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "saving",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "ready",
  },
]
`);
  });
  it('handles shutdown while connecting', async () => {
    const remoteStore = newRemoteStore(false);
    const localStore = newStore(remoteStore);
    const client = makeClient('a', 'test', localStore);
    await timeout();
    await client.shutdown();
  });

  it('syncs local pending changes in batches', async () => {
    const remoteStore = newRemoteStore(false);
    const localStore = newStore(remoteStore);
    const client = makeClient('a', 'test', localStore);
    client.updateDoc({}, 'initialize');
    client.updateDoc({ hello: 'world' }, 'add hello');
    client.updateDoc({ hello: 'world 2' }, 'edit hello');
    client.updateDoc({ hello: 'world 3' }, 'edit hello');
    client.updateDoc({ hello: 'world 4' }, 'edit hello');
    client.updateDoc({ hello: 'world 5' }, 'edit hello');
    client.updateDoc({ hello: 'world 6' }, 'edit hello');
    client.updateDoc({ hello: 'world 7' }, 'edit hello');
    client.updateDoc({ hello: 'world 8' }, 'edit hello');

    await timeout();

    remoteStore.online = true;

    // Wait for reconnect
    await timeout(50);

    const localGraph1 = basicGraph(localStore, client);
    const remoteGraph1 = basicGraph(remoteStore, client);
    expect(remoteGraph1).toEqual(localGraph1);
    expect(localGraph1).toMatchInlineSnapshot(`
      Array [
        Object {
          "graph": "undefined -> DuQe--Vh",
          "step": "User a: initialize",
          "value": Object {},
        },
        Object {
          "graph": "DuQe--Vh -> u0wBto6f",
          "step": "User a: add hello",
          "value": Object {
            "hello": "world",
          },
        },
        Object {
          "graph": "u0wBto6f -> mtMnDodx",
          "step": "User a: edit hello",
          "value": Object {
            "hello": "world 2",
          },
        },
        Object {
          "graph": "mtMnDodx -> tB2Oxxss",
          "step": "User a: edit hello",
          "value": Object {
            "hello": "world 3",
          },
        },
        Object {
          "graph": "tB2Oxxss -> ltIl6khP",
          "step": "User a: edit hello",
          "value": Object {
            "hello": "world 4",
          },
        },
        Object {
          "graph": "ltIl6khP -> 6_CORFe7",
          "step": "User a: edit hello",
          "value": Object {
            "hello": "world 5",
          },
        },
        Object {
          "graph": "6_CORFe7 -> OhiKsT4g",
          "step": "User a: edit hello",
          "value": Object {
            "hello": "world 6",
          },
        },
        Object {
          "graph": "OhiKsT4g -> bTzlNzXZ",
          "step": "User a: edit hello",
          "value": Object {
            "hello": "world 7",
          },
        },
        Object {
          "graph": "bTzlNzXZ -> ilW_0_ne",
          "step": "User a: edit hello",
          "value": Object {
            "hello": "world 8",
          },
        },
      ]
    `);
  });

  it('syncs two clients to a remote', async () => {
    const remoteStore = newStore();
    const localStore = newStore(remoteStore);
    const client1 = makeClient('test', 'a', localStore);

    const syncUpdates1: SyncStatus[] = [];
    client1.subscribeSyncStatus((state) => syncUpdates1.push(state));

    client1.updateDoc({}, 'initialize');
    client1.updateDoc({ hello: 'world' }, 'add hello');

    await timeout();

    const client2 = makeClient('test', 'b', localStore);

    const syncUpdates2: SyncStatus[] = [];
    client2.subscribeSyncStatus((state) => syncUpdates2.push(state));

    await timeout();

    expect(syncUpdates1).toMatchInlineSnapshot(`
Array [
  Object {
    "localRead": "loading",
    "localSave": "ready",
    "remoteConnect": "offline",
    "remoteRead": "offline",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "loading",
    "localSave": "pending",
    "remoteConnect": "offline",
    "remoteRead": "offline",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "pending",
    "remoteConnect": "offline",
    "remoteRead": "offline",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "pending",
    "remoteConnect": "connecting",
    "remoteRead": "loading",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "pending",
    "remoteConnect": "online",
    "remoteRead": "loading",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "pending",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "saving",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "saving",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "pending",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "pending",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "saving",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "ready",
  },
]
`);
    expect(syncUpdates2).toMatchInlineSnapshot(`
      Array [
        Object {
          "localRead": "loading",
          "localSave": "ready",
          "remoteConnect": "offline",
          "remoteRead": "offline",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "loading",
          "localSave": "ready",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "ready",
        },
      ]
    `);
  });

  it('syncs two clients to remote with a local split', async () => {
    const remoteStore = newStore();
    const localStore = newStore(remoteStore);
    const client1 = makeClient('test', 'a', localStore);
    const client2 = makeClient('test', 'b', localStore);

    const states1: TestDoc[] = [];
    client1.subscribeDoc((state) => states1.push(state));
    const states2: TestDoc[] = [];
    client2.subscribeDoc((state) => states2.push(state));

    client1.updateDoc({}, 'initialize');
    client1.updateDoc({ hello: 'world' }, 'add hello');

    await timeout();

    expect(states1).toMatchInlineSnapshot(`
      Array [
        undefined,
        Object {},
        Object {
          "hello": "world",
        },
      ]
    `);
    expect(states2).toMatchInlineSnapshot(`
Array [
  undefined,
  Object {
    "hello": "world",
  },
]
`);

    localStore.localNetworkPaused = true;

    await timeout();

    client2.updateDoc({ hello: 'world', world: 'hello' }, 'add world');

    await timeout(100);

    expect(states1).toMatchInlineSnapshot(`
      Array [
        undefined,
        Object {},
        Object {
          "hello": "world",
        },
      ]
    `);
    expect(states2).toMatchInlineSnapshot(`
Array [
  undefined,
  Object {
    "hello": "world",
  },
  Object {
    "hello": "world",
    "world": "hello",
  },
]
`);

    localStore.localNetworkPaused = false;

    await timeout(100);

    expect(states1).toMatchInlineSnapshot(`
      Array [
        undefined,
        Object {},
        Object {
          "hello": "world",
        },
        Object {
          "hello": "world",
          "world": "hello",
        },
      ]
    `);
    expect(states2).toMatchInlineSnapshot(`
Array [
  undefined,
  Object {
    "hello": "world",
  },
  Object {
    "hello": "world",
    "world": "hello",
  },
]
`);
  });

  it('syncs one clients to a store multiple times', async () => {
    const remoteStore = newStore();
    const localStore = newStore(remoteStore);
    const client = makeClient('a', 'test', localStore);

    const syncUpdates: SyncStatus[] = [];
    client.subscribeSyncStatus((state) => syncUpdates.push(state));

    client.updateDoc({}, 'initialize');
    client.updateDoc({ hello: 'world' }, 'add hello');

    await timeout();

    // Kill the "connection"
    remoteStore.remotes[0].fail('testing', 'network');

    client.updateDoc({ hello: 'vorld' }, 'change hello');
    client.updateDoc({ hello: 'borld' }, 'change hello');

    const localGraph2 = basicGraph(localStore, client);
    const remoteGraph2 = basicGraph(remoteStore, client);
    expect(remoteGraph2).toEqual(localGraph2);

    // Need to wait longer for the "reconnect"
    await timeout(10);

    const localGraph3 = basicGraph(localStore, client);
    const remoteGraph3 = basicGraph(remoteStore, client);
    expect(remoteGraph3).toEqual(localGraph3);

    expect(syncUpdates).toMatchInlineSnapshot(`
Array [
  Object {
    "localRead": "loading",
    "localSave": "ready",
    "remoteConnect": "offline",
    "remoteRead": "offline",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "loading",
    "localSave": "pending",
    "remoteConnect": "offline",
    "remoteRead": "offline",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "pending",
    "remoteConnect": "offline",
    "remoteRead": "offline",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "pending",
    "remoteConnect": "connecting",
    "remoteRead": "loading",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "pending",
    "remoteConnect": "online",
    "remoteRead": "loading",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "pending",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "saving",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "saving",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "pending",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "pending",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "saving",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "pending",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "pending",
    "remoteConnect": "offline",
    "remoteRead": "offline",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "saving",
    "remoteConnect": "offline",
    "remoteRead": "offline",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "saving",
    "remoteConnect": "offline",
    "remoteRead": "offline",
    "remoteSave": "pending",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "offline",
    "remoteRead": "offline",
    "remoteSave": "pending",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "offline",
    "remoteRead": "offline",
    "remoteSave": "saving",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "connecting",
    "remoteRead": "loading",
    "remoteSave": "saving",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "online",
    "remoteRead": "loading",
    "remoteSave": "saving",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "saving",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "ready",
  },
]
`);
  });

  it('handles leader network split', async () => {
    const remoteStore = newStore();
    const localStore = newStore(remoteStore);
    const client1 = makeClient('test', 'a', localStore);
    const client2 = makeClient('test', 'b', localStore);

    const syncUpdates: SyncStatus[] = [];
    client1.subscribeSyncStatus((state) => syncUpdates.push(state));

    localStore.localNetworkPaused = true;

    expect(client1.isRemoteLeader).toBe(false);
    expect(client2.isRemoteLeader).toBe(false);

    // wait for election
    await timeout(100);

    expect(client1.isRemoteLeader).toBe(true);
    expect(client2.isRemoteLeader).toBe(true);

    expect(client1.syncStatus).toMatchInlineSnapshot(`
      Object {
        "localRead": "ready",
        "localSave": "ready",
        "remoteConnect": "online",
        "remoteRead": "ready",
        "remoteSave": "ready",
      }
    `);

    expect(client2.syncStatus).toMatchInlineSnapshot(`
      Object {
        "localRead": "ready",
        "localSave": "ready",
        "remoteConnect": "online",
        "remoteRead": "ready",
        "remoteSave": "ready",
      }
    `);

    localStore.localNetworkPaused = false;

    await timeout(100);

    expect(client1.isRemoteLeader).toBe(true);
    expect(client2.isRemoteLeader).toBe(false);

    expect(client1.syncStatus).toMatchInlineSnapshot(`
      Object {
        "localRead": "ready",
        "localSave": "ready",
        "remoteConnect": "online",
        "remoteRead": "ready",
        "remoteSave": "ready",
      }
    `);

    expect(client2.syncStatus).toMatchInlineSnapshot(`
      Object {
        "localRead": "ready",
        "localSave": "ready",
        "remoteConnect": "online",
        "remoteRead": "ready",
        "remoteSave": "ready",
      }
    `);
  });

  it('syncs two client stores to a remote store', async () => {
    const remoteStore = newStore();
    const store1 = newStore(remoteStore);
    const store2 = newStore(remoteStore);
    const client1 = makeClient('a', 'a', store1);
    const client2 = makeClient('b', 'b', store2);

    const syncUpdates1: SyncStatus[] = [];
    const syncUpdates2: SyncStatus[] = [];
    client1.subscribeSyncStatus((state) => syncUpdates1.push(state));
    client2.subscribeSyncStatus((state) => syncUpdates2.push(state));

    client1.updateDoc({}, 'initialize');
    client1.updateDoc({ hello: 'world' }, 'add hello');
    client1.updateDoc({ hello: 'vorld' }, 'change hello');

    expect(client1.doc).toEqual({ hello: 'vorld' });
    expect(client2.doc).toEqual(undefined);

    await timeout();

    expect(client1.doc).toEqual({ hello: 'vorld' });
    expect(client2.doc).toEqual({ hello: 'vorld' });

    client2.updateDoc({ hello: 'vorld', world: 'world' }, 'add world');
    client2.updateDoc({ hello: 'vorld', world: 'vorld' }, 'change world');

    // Now client 2 is updated but not client 1
    expect(client1.doc).toEqual({ hello: 'vorld' });
    expect(client2.doc).toEqual({ hello: 'vorld', world: 'vorld' });

    await timeout();

    expect(client1.doc).toEqual({ hello: 'vorld', world: 'vorld' });
    expect(client2.doc).toEqual({ hello: 'vorld', world: 'vorld' });

    const graph1 = basicGraph(store1, client1);
    const graph2 = basicGraph(store2, client1);
    expect(graph1).toMatchInlineSnapshot(`
      Array [
        Object {
          "graph": "undefined -> DuQe--Vh",
          "step": "User a: initialize",
          "value": Object {},
        },
        Object {
          "graph": "DuQe--Vh -> u0wBto6f",
          "step": "User a: add hello",
          "value": Object {
            "hello": "world",
          },
        },
        Object {
          "graph": "u0wBto6f -> YYUSBDXS",
          "step": "User a: change hello",
          "value": Object {
            "hello": "vorld",
          },
        },
        Object {
          "graph": "YYUSBDXS -> YFIigfVr",
          "step": "User b: add world",
          "value": Object {
            "hello": "vorld",
            "world": "world",
          },
        },
        Object {
          "graph": "YFIigfVr -> 3duBmH5E",
          "step": "User b: change world",
          "value": Object {
            "hello": "vorld",
            "world": "vorld",
          },
        },
      ]
    `);
    expect(graph2).toEqual(graph1);

    await client1.shutdown();
    await client2.shutdown();

    expect(syncUpdates1).toMatchInlineSnapshot(`
Array [
  Object {
    "localRead": "loading",
    "localSave": "ready",
    "remoteConnect": "offline",
    "remoteRead": "offline",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "loading",
    "localSave": "pending",
    "remoteConnect": "offline",
    "remoteRead": "offline",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "pending",
    "remoteConnect": "offline",
    "remoteRead": "offline",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "pending",
    "remoteConnect": "connecting",
    "remoteRead": "loading",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "pending",
    "remoteConnect": "online",
    "remoteRead": "loading",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "pending",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "saving",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "saving",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "pending",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "pending",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "saving",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "offline",
    "remoteRead": "offline",
    "remoteSave": "ready",
  },
]
`);
    expect(syncUpdates2).toMatchInlineSnapshot(`
Array [
  Object {
    "localRead": "loading",
    "localSave": "ready",
    "remoteConnect": "offline",
    "remoteRead": "offline",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "offline",
    "remoteRead": "offline",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "connecting",
    "remoteRead": "loading",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "online",
    "remoteRead": "loading",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "pending",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "saving",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "saving",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "pending",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "pending",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "saving",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "online",
    "remoteRead": "ready",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "offline",
    "remoteRead": "offline",
    "remoteSave": "ready",
  },
]
`);
  });

  it('syncs three clients with two local stores', async () => {
    const remoteStore = newStore();
    const localStore1 = newStore(remoteStore);
    const localStore2 = newStore(remoteStore);
    const client1 = makeClient('a', 'client1', localStore1);
    const client2 = makeClient('b', 'client2', localStore2);
    const client3 = makeClient('b', 'client3', localStore2);

    expect(basicClients(client1)).toMatchInlineSnapshot(`
      Object {
        "a:client1": undefined,
      }
    `);
    expect(basicClients(client2)).toMatchInlineSnapshot(`
      Object {
        "b:client2": undefined,
      }
    `);
    expect(basicClients(client3)).toMatchInlineSnapshot(`
      Object {
        "b:client3": undefined,
      }
    `);

    await timeout();

    expect(basicClients(client1)).toMatchInlineSnapshot(`
      Object {
        "a:client1": undefined,
        "b:client2": undefined,
        "b:client3": undefined,
      }
    `);
    expect(basicClients(client2)).toMatchInlineSnapshot(`
      Object {
        "a:client1": undefined,
        "b:client2": undefined,
        "b:client3": undefined,
      }
    `);
    expect(basicClients(client3)).toMatchInlineSnapshot(`
      Object {
        "a:client1": undefined,
        "b:client2": undefined,
        "b:client3": undefined,
      }
    `);

    client1.updatePresence('presence 1');
    client2.updatePresence('presence 2');
    client3.updatePresence('presence 3');

    await timeout();

    expect(basicClients(client1)).toMatchInlineSnapshot(`
      Object {
        "a:client1": "presence 1",
        "b:client2": "presence 2",
        "b:client3": "presence 3",
      }
    `);
    expect(basicClients(client2)).toMatchInlineSnapshot(`
      Object {
        "a:client1": "presence 1",
        "b:client2": "presence 2",
        "b:client3": "presence 3",
      }
    `);
    expect(basicClients(client3)).toMatchInlineSnapshot(`
      Object {
        "a:client1": "presence 1",
        "b:client2": "presence 2",
        "b:client3": "presence 3",
      }
    `);
  });
});
