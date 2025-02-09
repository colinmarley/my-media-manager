import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, QueryConstraint } from 'firebase/firestore';
import { db } from '../../../firebaseConfig';
import { FBMovie } from '../../types/firebase/FBMovie.type';
import FirestoreService from '../../service/FirestoreService';

const useMovies = (conditions?: [string, any][]) => {
  const [movies, setMovies] = useState<FBMovie[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMovies = async () => {
      setLoading(true);
      setError(null);

      try {
        const service = new FirestoreService('movies');
        let q = query(collection(db, 'movies'));

        if (conditions) {
          const constraints: QueryConstraint[] = conditions.map(([field, value]) =>
            where(field, '==', value)
          );
          q = query(q, ...constraints);
        }

        const querySnapshot = await getDocs(q);
        const docs: FBMovie[] = querySnapshot.docs.map(doc => doc.data() as FBMovie);

        setMovies(docs);
      } catch (err: any) {
        console.error(typeof err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchMovies();
  }, [conditions]);

  return { movies, loading, error };
};

export default useMovies;