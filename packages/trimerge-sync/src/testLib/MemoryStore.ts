import {
  AckCommitsEvent,
  Commit,
  GetLocalStoreFn,
  GetRemoteFn,
  CommitsEvent,
  RemoteSyncInfo,
} from '../types';
import generate from 'project-name-generator';
import { PromiseQueue } from '../lib/PromiseQueue';
import { MemoryLocalStore } from './MemoryLocalStore';
import { MemoryRemote } from './MemoryRemote';

function getSyncCounter(syncCursor: string): number {
  return parseInt(syncCursor, 36);
}

function randomId() {
  return generate({ words: 3, alliterative: true }).dashed;
}

export class MemoryStore<EditMetadata, Delta, Presence> {
  public readonly remotes: MemoryRemote<EditMetadata, Delta, Presence>[] = [];
  private commits: Commit<EditMetadata, Delta>[] = [];
  private localCommitRefs = new Set<string>();
  private syncedCommits = new Set<string>();
  private readonly localStoreId = randomId();
  private lastRemoteSyncCursor: string | undefined;
  private queue = new PromiseQueue();
  private readonly localStores: MemoryLocalStore<
    EditMetadata,
    Delta,
    Presence
  >[] = [];

  public writeErrorMode = false;

  constructor(
    public readonly channelName: string = randomId(),
    private readonly getRemoteFn?: GetRemoteFn<EditMetadata, Delta, Presence>,
    public online = true,
  ) {}

  public getCommits(): readonly Commit<EditMetadata, Delta>[] {
    return this.commits;
  }

  private get syncCursor(): string {
    return this.commits.length.toString(36);
  }

  public set localNetworkPaused(paused: boolean) {
    for (const local of this.localStores) {
      local.channel.paused = paused;
    }
  }

  getLocalStore: GetLocalStoreFn<EditMetadata, Delta, Presence> = (
    userId,
    clientId,
    onEvent,
  ) => {
    const store = new MemoryLocalStore(
      this,
      userId,
      clientId,
      onEvent,
      this.getRemoteFn,
    );
    this.localStores.push(store);
    return store;
  };

  getRemote: GetRemoteFn<EditMetadata, Delta, Presence> = (
    userId: string,
    remoteSyncInfo,
    onEvent,
  ) => {
    if (!this.online) {
      throw new Error('offline');
    }
    const be = new MemoryRemote(this, userId, remoteSyncInfo, onEvent);
    this.remotes.push(be);
    return be;
  };

  addCommits(
    commits: readonly Commit<EditMetadata, Delta>[],
    remoteSyncId?: string,
  ): Promise<AckCommitsEvent> {
    return this.queue.add(async () => {
      const refs = new Set<string>();
      for (const commit of commits) {
        const { ref } = commit;
        if (!this.localCommitRefs.has(ref)) {
          this.commits.push(commit);
          this.localCommitRefs.add(ref);
        }
        refs.add(ref);
      }
      if (remoteSyncId !== undefined) {
        for (const { ref } of commits) {
          this.syncedCommits.add(ref);
        }
        this.lastRemoteSyncCursor = remoteSyncId;
      }
      return {
        type: 'ack',
        refs: Array.from(refs),
        syncId: this.syncCursor,
      };
    });
  }
  async acknowledgeCommits(
    refs: readonly string[],
    remoteSyncId: string,
  ): Promise<void> {
    return this.queue.add(async () => {
      for (const ref of refs) {
        this.syncedCommits.add(ref);
      }
      this.lastRemoteSyncCursor = remoteSyncId;
    });
  }

  getLocalCommitsEvent(
    startSyncCursor?: string,
  ): Promise<CommitsEvent<EditMetadata, Delta, Presence>> {
    return this.queue.add(async () => ({
      type: 'commits',
      commits:
        startSyncCursor !== undefined
          ? this.commits.slice(getSyncCounter(startSyncCursor))
          : this.commits,
      syncId: this.syncCursor,
    }));
  }
  getRemoteSyncInfo(): Promise<RemoteSyncInfo> {
    return this.queue.add(async () => ({
      localStoreId: this.localStoreId,
      lastSyncCursor: this.lastRemoteSyncCursor,
    }));
  }

  async *getCommitsForRemote(): AsyncIterableIterator<
    CommitsEvent<EditMetadata, Delta, Presence>
  > {
    const commits = await this.queue.add(async () =>
      this.commits.filter(({ ref }) => !this.syncedCommits.has(ref)),
    );
    const BATCH_SIZE = 5;
    for (let i = 0; i < commits.length; i += BATCH_SIZE) {
      yield {
        type: 'commits',
        commits: commits.slice(i, i + BATCH_SIZE),
      };
    }
  }

  async shutdown(): Promise<void> {
    return await this.queue.add(async () => {
      for (const remote of this.remotes) {
        await remote.shutdown();
      }
      for (const local of this.localStores) {
        await local.shutdown();
      }
    });
  }
}
