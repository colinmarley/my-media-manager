import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, QueryConstraint } from 'firebase/firestore';
import { db } from '../../../firebaseConfig';
import { FBRelease } from '../../types/firebase/FBRelease.type';
import FirestoreService from '../../service/FirestoreService';

const useReleases = (conditions?: [string, any][]) => {
  const [releases, setReleases] = useState<FBRelease[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchReleases = async () => {
      setLoading(true);
      setError(null);

      try {
        const service = new FirestoreService('releases');
        let q = query(collection(db, 'releases'));

        if (conditions) {
          const constraints: QueryConstraint[] = conditions.map(([field, value]) =>
            where(field, '==', value)
          );
          q = query(q, ...constraints);
        }

        const querySnapshot = await getDocs(q);
        const docs: FBRelease[] = querySnapshot.docs.map(doc => doc.data() as FBRelease);

        setReleases(docs);
      } catch (err: any) {
        console.error(typeof err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchReleases();
  }, [conditions]);

  return { releases, loading, error };
};

export default useReleases;