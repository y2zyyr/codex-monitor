import type { GambitSourceSnapshot } from './types';

export interface SnapshotBucket {
  put(key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream<Uint8Array>, options?: Record<string, unknown>): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  head?(key: string): Promise<unknown>;
}

export interface SnapshotStore {
  put(snapshot: GambitSourceSnapshot): Promise<{ key: string; hash: string }>;
  getByKey(key: string): Promise<GambitSourceSnapshot | null>;
}

export function snapshotKey(contentHash: string): string {
  return `gambit/snapshots/sha256/${contentHash}.json`;
}

export function serializeNormalizedSnapshot(snapshot: GambitSourceSnapshot): string {
  // The snapshot schema has no raw HTML field by design. Serialize only the
  // normalized content that was actually exposed to the model.
  return JSON.stringify({
    sourceId: snapshot.sourceId,
    requestedUrl: snapshot.requestedUrl,
    finalUrl: snapshot.finalUrl,
    canonicalUrl: snapshot.canonicalUrl,
    title: snapshot.title,
    publisher: snapshot.publisher,
    publishedAt: snapshot.publishedAt,
    retrievedAt: snapshot.retrievedAt,
    normalizedContent: snapshot.normalizedContent,
    contentHash: snapshot.contentHash,
    extractorVersion: snapshot.extractorVersion,
    sourceQualityTier: snapshot.sourceQualityTier,
    retentionUntil: snapshot.retentionUntil ?? null,
  });
}

export class R2SnapshotStore implements SnapshotStore {
  constructor(private readonly bucket: SnapshotBucket) {}

  async put(snapshot: GambitSourceSnapshot): Promise<{ key: string; hash: string }> {
    const key = snapshotKey(snapshot.contentHash);
    await this.bucket.put(key, serializeNormalizedSnapshot(snapshot), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
      customMetadata: {
        sourceId: snapshot.sourceId,
        contentHash: snapshot.contentHash,
        extractorVersion: snapshot.extractorVersion,
      },
    });
    return { key, hash: snapshot.contentHash };
  }

  async getByKey(key: string): Promise<GambitSourceSnapshot | null> {
    const object = await this.bucket.get(key);
    if (!object) return null;
    try {
      return JSON.parse(await object.text()) as GambitSourceSnapshot;
    } catch {
      return null;
    }
  }
}

/** A deterministic R2-compatible local emulator for unit tests and the demo. */
export class MemorySnapshotBucket implements SnapshotBucket {
  private readonly values = new Map<string, string>();

  async put(key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream<Uint8Array>): Promise<void> {
    if (typeof value === 'string') {
      this.values.set(key, value);
      return;
    }
    if (value instanceof ArrayBuffer) {
      this.values.set(key, new TextDecoder().decode(value));
      return;
    }
    if (ArrayBuffer.isView(value)) {
      this.values.set(key, new TextDecoder().decode(value));
      return;
    }
    const reader = value.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      chunks.push(part.value);
    }
    const total = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
      total.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.values.set(key, new TextDecoder().decode(total));
  }

  async get(key: string): Promise<{ text(): Promise<string> } | null> {
    const value = this.values.get(key);
    return value === undefined ? null : { text: async () => value };
  }

  has(key: string): boolean {
    return this.values.has(key);
  }

  size(): number {
    return this.values.size;
  }
}

export function snapshotStoreForBucket(bucket: SnapshotBucket | undefined): SnapshotStore | null {
  return bucket ? new R2SnapshotStore(bucket) : null;
}
