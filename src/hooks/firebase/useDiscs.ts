import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, QueryConstraint } from 'firebase/firestore';
import { db } from '../../../firebaseConfig';
import { FBDisc } from '../../types/firebase/FBDisc.type';
import FirestoreService from '../../service/FirestoreService';

const useDiscs = (conditions?: [string, any][]) => {
  const [discs, setDiscs] = useState<FBDisc[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDiscs = async () => {
      setLoading(true);
      setError(null);

      try {
        const service = new FirestoreService('discs');
        let q = query(collection(db, 'discs'));

        if (conditions) {
          const constraints: QueryConstraint[] = conditions.map(([field, value]) =>
            where(field, '==', value)
          );
          q = query(q, ...constraints);
        }

        const querySnapshot = await getDocs(q);
        const docs: FBDisc[] = querySnapshot.docs.map(doc => doc.data() as FBDisc);

        setDiscs(docs);
      } catch (err: any) {
        console.error(typeof err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchDiscs();
  }, [conditions]);

  return { discs, loading, error };
};

export default useDiscs;