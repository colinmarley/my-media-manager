import { 
  collection, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  getDocs, 
  query, 
  where, 
  orderBy,
  onSnapshot,
  Timestamp 
} from 'firebase/firestore';
import { User } from 'firebase/auth';
import { db } from '../../../firebaseConfig';
import { LibraryPath } from '../../types/library/LibraryTypes';

export interface FirebaseLibraryPath extends Omit<LibraryPath, 'id' | 'createdAt' | 'lastScanned'> {
  userId: string;
  createdAt: Timestamp;
  lastScanned?: Timestamp;
}

export class FirebaseLibraryService {
  private collectionName = 'user_library_paths';

  /**
   * Save a library path to Firebase
   */
  async addLibraryPath(user: User, libraryPath: Omit<LibraryPath, 'id'>): Promise<string> {
    try {
      const firebasePath: Partial<FirebaseLibraryPath> = {
        name: libraryPath.name,
        rootPath: libraryPath.rootPath,
        mediaType: libraryPath.mediaType,
        isActive: libraryPath.isActive,
        userId: user.uid,
        createdAt: Timestamp.now()
      };

      // Only add lastScanned if it exists
      if (libraryPath.lastScanned) {
        firebasePath.lastScanned = Timestamp.fromDate(libraryPath.lastScanned);
      }

      const docRef = await addDoc(collection(db, this.collectionName), firebasePath);
      console.log('Library path added with ID:', docRef.id);
      return docRef.id;
    } catch (error) {
      console.error('Error adding library path:', error);
      throw error;
    }
  }

  /**
   * Update a library path in Firebase
   */
  async updateLibraryPath(user: User, pathId: string, updates: Partial<LibraryPath>): Promise<void> {
    try {
      const docRef = doc(db, this.collectionName, pathId);
      
      const firebaseUpdates: Partial<Record<string, any>> = {};
      
      // Only include fields that have values
      if (updates.name !== undefined) firebaseUpdates.name = updates.name;
      if (updates.rootPath !== undefined) firebaseUpdates.rootPath = updates.rootPath;
      if (updates.mediaType !== undefined) firebaseUpdates.mediaType = updates.mediaType;
      if (updates.isActive !== undefined) firebaseUpdates.isActive = updates.isActive;
      if (updates.lastScanned !== undefined) {
        firebaseUpdates.lastScanned = Timestamp.fromDate(updates.lastScanned);
      }

      await updateDoc(docRef, firebaseUpdates);
      console.log('Library path updated:', pathId);
    } catch (error) {
      console.error('Error updating library path:', error);
      throw error;
    }
  }

  /**
   * Delete a library path from Firebase
   */
  async deleteLibraryPath(user: User, pathId: string): Promise<void> {
    try {
      const docRef = doc(db, this.collectionName, pathId);
      await deleteDoc(docRef);
      console.log('Library path deleted:', pathId);
    } catch (error) {
      console.error('Error deleting library path:', error);
      throw error;
    }
  }

  /**
   * Get all library paths for a user
   */
  async getUserLibraryPaths(user: User): Promise<LibraryPath[]> {
    try {
      const q = query(
        collection(db, this.collectionName),
        where('userId', '==', user.uid)
        // Removed orderBy to avoid requiring composite index
      );

      const querySnapshot = await getDocs(q);
      const paths: LibraryPath[] = [];

      querySnapshot.forEach((doc) => {
        const data = doc.data() as FirebaseLibraryPath;
        paths.push({
          id: doc.id,
          name: data.name,
          rootPath: data.rootPath,
          mediaType: data.mediaType,
          isActive: data.isActive,
          createdAt: data.createdAt.toDate(),
          lastScanned: data.lastScanned?.toDate()
        });
      });

      // Sort by createdAt descending in JavaScript instead
      paths.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      return paths;
    } catch (error) {
      console.error('Error fetching user library paths:', error);
      throw error;
    }
  }

  /**
   * Subscribe to library paths changes for real-time updates
   */
  subscribeToLibraryPaths(user: User, callback: (paths: LibraryPath[]) => void): () => void {
    const q = query(
      collection(db, this.collectionName),
      where('userId', '==', user.uid)
      // Removed orderBy to avoid requiring composite index
    );

    return onSnapshot(q, (querySnapshot) => {
      const paths: LibraryPath[] = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data() as FirebaseLibraryPath;
        paths.push({
          id: doc.id,
          name: data.name,
          rootPath: data.rootPath,
          mediaType: data.mediaType,
          isActive: data.isActive,
          createdAt: data.createdAt.toDate(),
          lastScanned: data.lastScanned?.toDate()
        });
      });
      
      // Sort by createdAt descending in JavaScript instead
      paths.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      
      callback(paths);
    }, (error) => {
      console.error('Error in library paths subscription:', error);
    });
  }

  /**
   * Get scan results for a user
   */
  async getUserScanResults(user: User): Promise<any[]> {
    try {
      const q = query(
        collection(db, 'scan_results'),
        where('userId', '==', user.uid)
        // Removed orderBy to avoid requiring composite index
      );

      const querySnapshot = await getDocs(q);
      const results: any[] = [];

      querySnapshot.forEach((doc) => {
        results.push({
          id: doc.id,
          ...doc.data()
        });
      });

      // Sort by createdAt descending in JavaScript instead
      results.sort((a, b) => {
        const aDate = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt);
        const bDate = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
        return bDate.getTime() - aDate.getTime();
      });

      return results;
    } catch (error) {
      console.error('Error fetching scan results:', error);
      throw error;
    }
  }

  /**
   * Get existing files for a user from all scans
   */
  async getUserExistingFiles(user: User): Promise<any[]> {
    try {
      const q = query(
        collection(db, 'scanned_files'),
        where('userId', '==', user.uid)
      );

      const querySnapshot = await getDocs(q);
      const files: any[] = [];

      querySnapshot.forEach((doc) => {
        const data = doc.data();
        files.push({
          path: data.path,
          libraryPath: data.libraryPath,
          name: data.name,
          extension: data.extension || '',
          media_type: data.media_type || 'unknown',
          metadata: data.metadata || {},
          media_metadata: data.media_metadata || {},
          parsed_info: data.parsed_info || {}
        });
      });

      return files;
    } catch (error) {
      console.error('Error fetching existing files:', error);
      throw error;
    }
  }

  /**
   * Get existing directories for a user from all scans
   */
  async getUserExistingDirectories(user: User): Promise<any[]> {
    try {
      const q = query(
        collection(db, 'scanned_directories'),
        where('userId', '==', user.uid)
      );

      const querySnapshot = await getDocs(q);
      const directories: any[] = [];

      querySnapshot.forEach((doc) => {
        const data = doc.data();
        directories.push({
          path: data.path,
          libraryPath: data.libraryPath,
          name: data.name,
          media_type: data.media_type || 'unknown',
          metadata: data.metadata || {}
        });
      });

      return directories;
    } catch (error) {
      console.error('Error fetching existing directories:', error);
      throw error;
    }
  }
}

export const firebaseLibraryService = new FirebaseLibraryService();