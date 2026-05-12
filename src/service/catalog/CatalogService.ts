/**
 * CatalogService — REST API wrapper for the backend catalog.
 *
 * Provides a unified document-style interface so that form components, hooks,
 * and stores can read/write catalog data without knowing the underlying storage.
 * All reads and writes go through the backend REST API (PostgreSQL on the server).
 *
 * Collection routing:
 *   movies | series | discs  →  /api/catalog/{collection}/{id}
 *   everything else          →  /api/data/{collection}/{id}
 */
import { api } from '../api/apiClient';
import { LibraryPath } from '../../types/library/LibraryTypes';

const CATALOG_COLLECTIONS = new Set(['movies', 'series', 'discs']);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DocumentData = Record<string, any>;

class CatalogService {
  private collection: string;

  constructor(collectionName: string) {
    this.collection = collectionName;
  }

  private isCatalog(): boolean {
    return CATALOG_COLLECTIONS.has(this.collection);
  }

  private basePath(): string {
    return this.isCatalog()
      ? `/api/catalog/${this.collection}`
      : `/api/data/${this.collection}`;
  }

  private generateId(prefix: string): string {
    const maybeCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (maybeCrypto && typeof maybeCrypto.randomUUID === 'function') {
      return maybeCrypto.randomUUID();
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  async addDocument(data: DocumentData): Promise<void> {
    const id = (data.id as string) || this.generateId(this.collection || 'doc');
    try {
      await api.put<DocumentData>(`${this.basePath()}/${id}`, { ...data, id });
      const displayName =
        (data.title as string) ||
        (data.fullName as string) ||
        (data.name as string) ||
        'document';
      alert(`Added ${displayName} to the database`);
    } catch (e) {
      console.error('Error adding document:', e);
    }
  }

  async getDocuments(): Promise<DocumentData[]> {
    try {
      return await api.get<DocumentData[]>(this.basePath());
    } catch (e) {
      console.warn(`Error getting documents from ${this.collection}:`, e);
      return [];
    }
  }

  async getDocumentsByField(field: string, value: unknown): Promise<DocumentData[]> {
    const all = await this.getDocuments();
    return all.filter((doc) => doc[field] === value);
  }

  async getDocumentById(id: string): Promise<DocumentData | null> {
    try {
      return await api.get<DocumentData>(`${this.basePath()}/${id}`);
    } catch {
      return null;
    }
  }

  async updateDocument(id: string, data: Partial<DocumentData>): Promise<void> {
    try {
      const existing = await this.getDocumentById(id);
      const merged = { ...(existing || {}), ...data, id };
      await api.put<DocumentData>(`${this.basePath()}/${id}`, merged);
    } catch (e) {
      console.error('Error updating document:', e);
    }
  }

  async deleteDocument(id: string): Promise<void> {
    try {
      await api.delete(`${this.basePath()}/${id}`);
    } catch (e) {
      console.error('Error deleting document:', e);
    }
  }

  // ---------------------------------------------------------------------------
  // Library-path helpers (kept for backward compatibility)
  // ---------------------------------------------------------------------------

  async addLibraryPath(libraryPath: Omit<LibraryPath, 'id'>): Promise<string | null> {
    try {
      const result = await api.post<{ id: string }>('/api/library-paths', libraryPath);
      return result.id;
    } catch (e) {
      console.error('Error adding library path:', e);
      return null;
    }
  }

  async getLibraryPaths(): Promise<LibraryPath[]> {
    try {
      return await api.get<LibraryPath[]>('/api/library-paths');
    } catch (e) {
      console.error('Error getting library paths:', e);
      return [];
    }
  }

  async updateLibraryPath(pathId: string, updates: Partial<LibraryPath>): Promise<void> {
    try {
      await api.put(`/api/library-paths/${pathId}`, updates);
    } catch (e) {
      console.error('Error updating library path:', e);
    }
  }

  async deleteLibraryPath(pathId: string): Promise<void> {
    try {
      await api.delete(`/api/library-paths/${pathId}`);
    } catch (e) {
      console.error('Error deleting library path:', e);
    }
  }
}

export default CatalogService;

