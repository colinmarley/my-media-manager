import { db } from '../../firebaseConfig';
import { collection, addDoc, getDocs, query, where, DocumentData } from 'firebase/firestore';

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
    const q = query(collection(db, this.collectionName), where(field, '==', value));
    const querySnapshot = await getDocs(q);
    const documents: DocumentData[] = [];
    querySnapshot.forEach((doc) => {
      documents.push({ id: doc.id, ...doc.data() });
    });
    return documents;
  }
}

export default FirestoreService;