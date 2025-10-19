export interface VersionMetadata {
  versionId: string;
  createdAt: string;
  size: number;
  hash: string;
}

export interface ShareTokenView {
  token: string;
  expiresAt: number;
}

export interface StoredDocumentMetadata {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  size: number;
  versions: VersionMetadata[];
  ownerToken?: string;
  rawAccessKey?: string;
}

export interface DocumentView extends Omit<StoredDocumentMetadata, "ownerToken"> {
  isOwner: boolean;
  isPrivate: boolean;
}

export interface DocumentVersion {
  metadata: VersionMetadata;
  content: string;
}

export interface CreateDocumentRequest {
  title: string;
  content: string;
}

export interface UpdateDocumentRequest {
  content: string;
}

export interface ShareTokenPayload {
  documentId: string;
  expiresAt: number;
}

export interface DocumentListResponse {
  documents: DocumentView[];
  cursor?: string;
}

export interface UserTokenResponse {
  token: string;
}
