import { collection, addDoc, writeBatch, doc } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { db } from '../../../firebaseConfig';

export interface ScanResultData {
  scanId: string;
  files: any[];
  directories: any[];
  totalFiles: number;
  totalDirectories: number;
  duplicateReport?: {
    duplicates: Array<{
      path: string;
      type: 'file' | 'directory';
      differences: Array<{
        field: string;
        currentValue: any;
        newValue: any;
      }>;
    }>;
    totalScanned: number;
    newFiles: number;
    newDirectories: number;
  };
}

export class FirestoreScanService {
  /**
   * Save scan results to Firestore with user context
   */
  async saveScanResults(user: User, scanData: ScanResultData, libraryPath: string): Promise<void> {
    try {
      const batch = writeBatch(db);
      
      // Save scan result summary
      const scanResultRef = doc(collection(db, 'scan_results'));
      batch.set(scanResultRef, {
        scanId: scanData.scanId,
        userId: user.uid,
        libraryPath: libraryPath,
        status: 'completed',
        totalItems: scanData.totalFiles + scanData.totalDirectories,
        filesFound: scanData.totalFiles,
        directoriesFound: scanData.totalDirectories,
        startTime: Date.now(),
        endTime: Date.now(),
        createdAt: new Date(),
      });

      // Save files to scanned_files collection
      for (const file of scanData.files) {
        const fileRef = doc(collection(db, 'scanned_files'));
        batch.set(fileRef, {
          scanId: scanData.scanId,
          userId: user.uid,
          libraryPath: libraryPath,
          path: file.path,
          name: file.name,
          extension: file.extension || '',
          media_type: file.media_type || 'unknown',
          status: 'found',
          discoveredAt: new Date(),
          metadata: file.metadata || {},
          media_metadata: file.media_metadata || {},
          parsed_info: file.parsed_info || {}
        });
      }

      // Save directories to scanned_directories collection
      for (const directory of scanData.directories) {
        const dirRef = doc(collection(db, 'scanned_directories'));
        batch.set(dirRef, {
          scanId: scanData.scanId,
          userId: user.uid,
          libraryPath: libraryPath,
          path: directory.path,
          name: directory.name,
          media_type: directory.media_type || 'unknown',
          status: 'found',
          discoveredAt: new Date(),
          metadata: directory.metadata || {}
        });
      }

      // Commit all writes
      await batch.commit();
      console.log(`Successfully saved ${scanData.totalFiles} files and ${scanData.totalDirectories} directories to Firestore`);
      
    } catch (error) {
      console.error('Error saving scan results to Firestore:', error);
      throw error;
    }
  }

  /**
   * Save scan error to Firestore
   */
  async saveScanError(user: User, scanId: string, libraryPath: string, error: string): Promise<void> {
    try {
      await addDoc(collection(db, 'scan_results'), {
        scanId: scanId,
        userId: user.uid,
        libraryPath: libraryPath,
        status: 'error',
        error: error,
        createdAt: new Date(),
      });
    } catch (firestoreError) {
      console.error('Error saving scan error to Firestore:', firestoreError);
    }
  }
}

export const firestoreScanService = new FirestoreScanService();