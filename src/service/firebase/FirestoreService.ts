import { db } from '../../../firebaseConfig';
import { collection, addDoc, getDocs, query, where, DocumentData, onSnapshot, doc, getDoc } from 'firebase/firestore';


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

    if (docSnap) {
      return { id: docSnap.id, ...docSnap.data() };
    } else {
      console.log('No such document!');
      return null;
    }
  }

}

export default FirestoreService;