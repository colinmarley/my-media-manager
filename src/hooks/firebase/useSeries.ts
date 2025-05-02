import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, QueryConstraint } from 'firebase/firestore';
import { db } from '../../../firebaseConfig';
import { FBSeries } from '../../types/firebase/FBSeries.type';
import FirestoreService from '../../service/firebase/FirestoreService';

const useSeries = (conditions?: [string, any][]) => {
  const [series, setSeries] = useState<FBSeries[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSeries = async () => {
      setLoading(true);
      setError(null);

      try {
        const service = new FirestoreService('series');
        let q = query(collection(db, 'series'));

        if (conditions) {
          const constraints: QueryConstraint[] = conditions.map(([field, value]) =>
            where(field, '==', value)
          );
          q = query(q, ...constraints);
        }

        const querySnapshot = await getDocs(q);
        const docs: FBSeries[] = querySnapshot.docs.map(doc => doc.data() as FBSeries);

        setSeries(docs);
      } catch (err: any) {
        console.error(err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchSeries();
  }, [conditions]);

  return { series, loading, error };
};

export default useSeries;