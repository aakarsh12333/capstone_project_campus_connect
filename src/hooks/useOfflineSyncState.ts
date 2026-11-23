import { onSnapshotsInSync } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../firebase';

export function useOfflineSyncState() {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<string>(new Date().toISOString());
  const [syncCount, setSyncCount] = useState<number>(0);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const unsubscribe = onSnapshotsInSync(db, () => {
      setLastSyncedAt(new Date().toISOString());
      setSyncCount((c) => c + 1);
    });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribe();
    };
  }, []);

  return {
    isOnline,
    lastSyncedAt,
    syncCount,
  };
}
