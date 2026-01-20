import { db } from '../../../firebaseConfig';
import { collection, addDoc, getDocs, query, where, DocumentData, onSnapshot, doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { LibraryPath, ScanResult, MediaMatch } from '../../types/library/LibraryTypes';


class FirestoreService {
  private collectionName: string;

  constructor(collectionName: string) {
    this.collectionName = collectionName;
  }

  async addDocument(data: DocumentData): Promise<void> {
    try {
      const docRef = await addDoc(collection(db, this.collectionName), data);
      alert(`Added ${data.title} to the database`);
      console.log('Document written with ID: ', docRef.id);
    } catch (e) {
      console.error('Error adding document: ', e);
    }
  }

  async getDocuments(): Promise<DocumentData[]> {
    const q = query(collection(db, this.collectionName));
    const querySnapshot = await getDocs(q);
    const documents: DocumentData[] = [];
    querySnapshot.forEach((doc) => {
      documents.push({ id: doc.id, ...doc.data() });
    });
    return documents;
  }

  async getDocumentsByField(field: string, value: any): Promise<DocumentData[]> {
    // const docRef = collection(db, this.collectionName);
    const q = query(collection(db, this.collectionName), where(field, '==', value));
    const querySnapshot = await getDocs(q);
    console.log(querySnapshot);
    const documents: DocumentData[] = [];
    querySnapshot.forEach((doc) => {
      console.log(doc.data());
      documents.push({ id: doc.id, ...doc.data() });
    });
    return documents;
  }

  async getDocumentById(id: string): Promise<DocumentData | null> {
    const docRef = doc(db, this.collectionName, id);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      return { id: docSnap.id, ...docSnap.data() };
    } else {
      console.log('No such document!');
      return null;
    }
  }

  async updateDocument(id: string, data: Partial<DocumentData>): Promise<void> {
    try {
      const docRef = doc(db, this.collectionName, id);
      await updateDoc(docRef, data);
      console.log('Document updated successfully');
    } catch (e) {
      console.error('Error updating document: ', e);
    }
  }

  async deleteDocument(id: string): Promise<void> {
    try {
      const docRef = doc(db, this.collectionName, id);
      await deleteDoc(docRef);
      console.log('Document deleted successfully');
    } catch (e) {
      console.error('Error deleting document: ', e);
    }
  }

  // Library-specific methods

  /**
   * Add a library path configuration
   */
  async addLibraryPath(libraryPath: Omit<LibraryPath, 'id'>): Promise<string | null> {
    try {
      const docRef = await addDoc(collection(db, 'libraryPaths'), {
        ...libraryPath,
        createdAt: libraryPath.createdAt || new Date()
      });
      console.log('Library path added with ID: ', docRef.id);
      return docRef.id;
    } catch (e) {
      console.error('Error adding library path: ', e);
      return null;
    }
  }

  /**
   * Get all library paths for the current user
   */
  async getLibraryPaths(userId?: string): Promise<LibraryPath[]> {
    try {
      let q = query(collection(db, 'libraryPaths'));
      
      if (userId) {
        q = query(collection(db, 'libraryPaths'), where('userId', '==', userId));
      }

      const querySnapshot = await getDocs(q);
      const paths: LibraryPath[] = [];
      
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        paths.push({
          id: doc.id,
          name: data.name,
          rootPath: data.rootPath,
          mediaType: data.mediaType,
          isActive: data.isActive,
          lastScanned: data.lastScanned ? data.lastScanned.toDate() : undefined,
          createdAt: data.createdAt.toDate(),
          scanProgress: data.scanProgress
        });
      });
      
      return paths;
    } catch (e) {
      console.error('Error getting library paths: ', e);
      return [];
    }
  }

  /**
   * Update a library path
   */
  async updateLibraryPath(pathId: string, updates: Partial<LibraryPath>): Promise<void> {
    try {
      const docRef = doc(db, 'libraryPaths', pathId);
      await updateDoc(docRef, updates);
      console.log('Library path updated successfully');
    } catch (e) {
      console.error('Error updating library path: ', e);
    }
  }

  /**
   * Delete a library path
   */
  async deleteLibraryPath(pathId: string): Promise<void> {
    try {
      const docRef = doc(db, 'libraryPaths', pathId);
      await deleteDoc(docRef);
      console.log('Library path deleted successfully');
    } catch (e) {
      console.error('Error deleting library path: ', e);
    }
  }

  /**
   * Save scan results
   */
  async saveScanResult(scanResult: Omit<ScanResult, 'id'>): Promise<string | null> {
    try {
      const docRef = await addDoc(collection(db, 'scanResults'), {
        ...scanResult,
        startTime: scanResult.startTime,
        endTime: scanResult.endTime || null
      });
      console.log('Scan result saved with ID: ', docRef.id);
      return docRef.id;
    } catch (e) {
      console.error('Error saving scan result: ', e);
      return null;
    }
  }

  /**
   * Get scan results for a library path
   */
  async getScanResults(libraryPathId: string): Promise<ScanResult[]> {
    try {
      const q = query(
        collection(db, 'scanResults'), 
        where('libraryPath.id', '==', libraryPathId)
      );
      const querySnapshot = await getDocs(q);
      const results: ScanResult[] = [];
      
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        results.push({
          ...data as ScanResult,
          startTime: data.startTime.toDate(),
          endTime: data.endTime ? data.endTime.toDate() : undefined
        });
      });
      
      return results.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
    } catch (e) {
      console.error('Error getting scan results: ', e);
      return [];
    }
  }

  /**
   * Save media matches from scanning
   */
  async saveMediaMatches(matches: MediaMatch[]): Promise<void> {
    try {
      const batch = matches.map(match => 
        addDoc(collection(db, 'mediaMatches'), match)
      );
      await Promise.all(batch);
      console.log('Media matches saved successfully');
    } catch (e) {
      console.error('Error saving media matches: ', e);
    }
  }

  /**
   * Get media matches for review
   */
  async getMediaMatches(status?: 'matched' | 'unmatched' | 'conflict' | 'manual_review'): Promise<MediaMatch[]> {
    try {
      let q = query(collection(db, 'mediaMatches'));
      
      if (status) {
        q = query(collection(db, 'mediaMatches'), where('status', '==', status));
      }

      const querySnapshot = await getDocs(q);
      const matches: MediaMatch[] = [];
      
      querySnapshot.forEach((doc) => {
        matches.push(doc.data() as MediaMatch);
      });
      
      return matches;
    } catch (e) {
      console.error('Error getting media matches: ', e);
      return [];
    }
  }

  /**
   * Update media file info in existing movie/series documents
   */
  async updateMediaWithLibraryInfo(mediaId: string, libraryFiles: any[], folderPath?: string): Promise<void> {
    try {
      const updates: any = {
        libraryFiles,
        libraryStatus: 'available',
        lastVerified: new Date()
      };

      if (folderPath) {
        updates.folderPath = folderPath;
      }

      await this.updateDocument(mediaId, updates);
      console.log('Media library info updated successfully');
    } catch (e) {
      console.error('Error updating media library info: ', e);
    }
  }

}

export default FirestoreService;