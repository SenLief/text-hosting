import { nanoid } from "nanoid";
import type {
  DocumentListResponse,
  DocumentVersion,
  DocumentView,
  StoredDocumentMetadata,
} from "./types";

const DOCUMENT_KEY_PREFIX = "doc:";
const VERSION_KEY_PREFIX = "version:";
const PUBLIC_INDEX_KEY = "documents:public:index";
const OWNER_INDEX_PREFIX = "documents:owner:";

interface DocumentRecord {
  metadata: StoredDocumentMetadata;
}

function ownerIndexKey(ownerToken: string): string {
  return `${OWNER_INDEX_PREFIX}${ownerToken}`;
}

export class DocumentStore {
  constructor(private kv: KVNamespace, private maxSize: number) {}

  async createDocument(input: {
    title: string;
    content: string;
    ownerToken?: string;
  }): Promise<{ metadata: DocumentView; version: DocumentVersion }> {
    this.assertSize(input.content);
    const ownerToken = input.ownerToken?.trim() ? input.ownerToken.trim() : undefined;
    const id = nanoid(12);
    const versionId = nanoid(10);
    const now = new Date().toISOString();
    const size = new TextEncoder().encode(input.content).byteLength;
    const hash = await this.hashContent(input.content);
    const versionMetadata = {
      versionId,
      createdAt: now,
      size,
      hash,
    };

    const stored: StoredDocumentMetadata = {
      id,
      title: input.title,
      createdAt: now,
      updatedAt: now,
      size,
      versions: [versionMetadata],
      ownerToken,
      rawAccessKey: ownerToken ? nanoid(16) : undefined,
    };

    const tasks: Promise<unknown>[] = [
      this.putRecord(id, stored),
      this.putVersion(id, versionId, input.content),
      this.updatePublicIndex(stored.id, !ownerToken),
    ];

    if (ownerToken) {
      tasks.push(this.touchOwnerIndex(ownerToken, stored.id));
    }

    await Promise.all(tasks);

    return {
      metadata: this.toView(stored, ownerToken),
      version: { metadata: versionMetadata, content: input.content },
    };
  }

  async updateDocument(
    id: string,
    input: {
      content: string;
      ownerToken?: string;
    }
  ): Promise<{ metadata: DocumentView; version: DocumentVersion }> {
    this.assertSize(input.content);
    const record = await this.getRecord(id);
    if (!record) throw new Error("NOT_FOUND");
    const existingOwner = record.metadata.ownerToken?.trim()
      ? record.metadata.ownerToken?.trim()
      : undefined;
    const ownerToken = input.ownerToken?.trim() ? input.ownerToken.trim() : undefined;

    if (existingOwner) {
      if (existingOwner !== ownerToken) throw new Error("FORBIDDEN");
    } else if (ownerToken) {
      throw new Error("FORBIDDEN");
    }

    const versionId = nanoid(10);
    const now = new Date().toISOString();
    const size = new TextEncoder().encode(input.content).byteLength;
    const hash = await this.hashContent(input.content);

    const versionMetadata = {
      versionId,
      createdAt: now,
      size,
      hash,
    };

    record.metadata.updatedAt = now;
    record.metadata.size = size;
    record.metadata.versions = [versionMetadata, ...record.metadata.versions];

    if (existingOwner) {
      record.metadata.rawAccessKey = nanoid(16);
    }

    const tasks: Promise<unknown>[] = [
      this.putRecord(id, record.metadata),
      this.putVersion(id, versionId, input.content),
      this.updatePublicIndex(record.metadata.id, !existingOwner),
    ];
    if (existingOwner) {
      tasks.push(this.touchOwnerIndex(existingOwner, record.metadata.id));
    }

    await Promise.all(tasks);

    return {
      metadata: this.toView(record.metadata, ownerToken),
      version: { metadata: versionMetadata, content: input.content },
    };
  }

  async deleteDocument(id: string, ownerToken?: string): Promise<void> {
    const record = await this.getRecord(id);
    if (!record) throw new Error("NOT_FOUND");

    const existingOwner = record.metadata.ownerToken?.trim()
      ? record.metadata.ownerToken.trim()
      : undefined;
    const token = ownerToken?.trim() ? ownerToken.trim() : undefined;

    if (existingOwner) {
      if (existingOwner !== token) throw new Error("FORBIDDEN");
    } else if (token) {
      throw new Error("FORBIDDEN");
    }

    const tasks: Promise<unknown>[] = [
      this.deleteRecord(id),
      this.updatePublicIndex(id, false),
    ];

    if (existingOwner) {
      tasks.push(this.removeFromIndex(ownerIndexKey(existingOwner), id));
    }

    for (const version of record.metadata.versions) {
      tasks.push(this.deleteVersion(id, version.versionId));
    }

    await Promise.all(tasks);
  }

  async getDocument(id: string, viewerToken?: string): Promise<DocumentView | null> {
    const record = await this.getRecord(id);
    if (!record) return null;
    return this.toView(record.metadata, viewerToken);
  }

  async getRecord(id: string): Promise<DocumentRecord | null> {
    const stored = await this.kv.get<DocumentRecord>(`${DOCUMENT_KEY_PREFIX}${id}`, "json");
    if (!stored) return null;
    return stored;
  }

  async getVersion(id: string, versionId: string): Promise<DocumentVersion | null> {
    const content = await this.kv.get(`${VERSION_KEY_PREFIX}${id}:${versionId}`);
    if (!content) return null;
    const record = await this.getRecord(id);
    if (!record) return null;
    const versionMetadata = record.metadata.versions.find((v) => v.versionId === versionId);
    if (!versionMetadata) return null;
    return { metadata: versionMetadata, content };
  }

  async listPublicDocuments(
    viewerToken: string | undefined,
    limit = 20,
    cursor?: string
  ): Promise<DocumentListResponse> {
    const index = await this.getIndex(PUBLIC_INDEX_KEY);
    const { slice, nextCursor } = this.sliceIndex(index, limit, cursor);
    const documents = await this.loadViews(slice, viewerToken);
    return { documents, cursor: nextCursor };
  }

  async listOwnerDocuments(
    ownerToken: string | undefined,
    limit = 20,
    cursor?: string
  ): Promise<DocumentListResponse> {
    if (!ownerToken) {
      return { documents: [], cursor: undefined };
    }
    const index = await this.getIndex(ownerIndexKey(ownerToken));
    const { slice, nextCursor } = this.sliceIndex(index, limit, cursor);
    const documents = await this.loadViews(slice, ownerToken);
    return { documents, cursor: nextCursor };
  }

  private async loadViews(ids: string[], viewerToken?: string): Promise<DocumentView[]> {
    const result: DocumentView[] = [];
    for (const id of ids) {
      const record = await this.getRecord(id);
      if (!record) continue;
      if (record.metadata.ownerToken && record.metadata.ownerToken !== viewerToken) {
        continue;
      }
      result.push(this.toView(record.metadata, viewerToken));
    }
    return result;
  }

  private toView(metadata: StoredDocumentMetadata, viewerToken?: string): DocumentView {
    const { ownerToken, rawAccessKey, ...rest } = metadata;
    const hasOwner = Boolean(ownerToken);
    const isOwner = hasOwner ? viewerToken === ownerToken : false;
    return {
      ...rest,
      isOwner,
      isPrivate: hasOwner,
      rawAccessKey: hasOwner ? rawAccessKey : undefined,
    };
  }

  private async putRecord(id: string, metadata: StoredDocumentMetadata) {
    const record: DocumentRecord = { metadata };
    await this.kv.put(`${DOCUMENT_KEY_PREFIX}${id}`, JSON.stringify(record));
  }

  private async putVersion(id: string, versionId: string, content: string) {
    await this.kv.put(`${VERSION_KEY_PREFIX}${id}:${versionId}`, content);
  }

  private async deleteRecord(id: string) {
    await this.kv.delete(`${DOCUMENT_KEY_PREFIX}${id}`);
  }

  private async deleteVersion(id: string, versionId: string) {
    await this.kv.delete(`${VERSION_KEY_PREFIX}${id}:${versionId}`);
  }

  private assertSize(content: string) {
    const size = new TextEncoder().encode(content).byteLength;
    if (size > this.maxSize) throw new Error("FILE_TOO_LARGE");
  }

  private async hashContent(content: string): Promise<string> {
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(content)
    );
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  private async touchOwnerIndex(ownerToken: string | undefined, documentId: string) {
    if (!ownerToken) return;
    await this.pushToIndex(ownerIndexKey(ownerToken), documentId);
  }

  private async updatePublicIndex(documentId: string, isPublic: boolean) {
    if (isPublic) {
      await this.pushToIndex(PUBLIC_INDEX_KEY, documentId);
    } else {
      await this.removeFromIndex(PUBLIC_INDEX_KEY, documentId);
    }
  }

  private async pushToIndex(key: string, id: string) {
    const index = await this.getIndex(key);
    const filtered = index.filter((existing) => existing !== id);
    filtered.unshift(id);
    await this.kv.put(key, JSON.stringify(filtered));
  }

  private async removeFromIndex(key: string, id: string) {
    const index = await this.getIndex(key);
    const filtered = index.filter((existing) => existing !== id);
    await this.kv.put(key, JSON.stringify(filtered));
  }

  private async getIndex(key: string): Promise<string[]> {
    const value = await this.kv.get(key);
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  private sliceIndex(index: string[], limit: number, cursor?: string) {
    const start = cursor ? Math.max(index.indexOf(cursor) + 1, 0) : 0;
    const slice = index.slice(start, start + limit);
    const nextCursor = start + limit < index.length ? index[start + limit - 1] : undefined;
    return { slice, nextCursor };
  }
}
