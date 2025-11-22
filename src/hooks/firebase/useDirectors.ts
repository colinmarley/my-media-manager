import { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../../firebaseConfig';
import { Director } from '@/types/collections/Director.type';

const useDirectors = () => {
  const [directors, setDirectors] = useState<Director[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDirectors = async () => {
      setLoading(true);
      setError(null);

      try {
        const querySnapshot = await getDocs(collection(db, 'directors'));
        const fetchedDirectors = querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Director));
        setDirectors(fetchedDirectors);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchDirectors();
  }, []);

  const addDirector = async (newDirector: Omit<Director, 'id'>) => {
    try {
      const docRef = await addDoc(collection(db, 'directors'), newDirector);
      setDirectors((prev) => [...prev, { id: docRef.id, ...newDirector }]);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const updateDirector = async (id: string, updatedData: Partial<Director>) => {
    try {
      const docRef = doc(db, 'directors', id);
      await updateDoc(docRef, updatedData);
      setDirectors((prev) => prev.map((director) => (director.id === id ? { ...director, ...updatedData } : director)));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const deleteDirector = async (id: string) => {
    try {
      const docRef = doc(db, 'directors', id);
      await deleteDoc(docRef);
      setDirectors((prev) => prev.filter((director) => director.id !== id));
    } catch (err: any) {
      setError(err.message);
    }
  };

  return { directors, loading, error, addDirector, updateDirector, deleteDirector };
};

export default useDirectors;