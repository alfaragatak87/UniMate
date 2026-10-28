import { useCallback, useRef, useState } from 'react';
import { createLocalStorageController } from '../services/storageSafety';

export function useLocalStorage(key, initialValue, options = {}) {
  const controllerRef = useRef(null);
  if (controllerRef.current === null) {
    let storage = null;
    if (typeof window !== 'undefined') {
      try {
        storage = window.localStorage;
      } catch {
        storage = null;
      }
    }
    controllerRef.current = createLocalStorageController({
      storage,
      key,
      initialValue,
      validate: options.validate,
    });
  }

  const initialSnapshot = controllerRef.current.getSnapshot();
  const [storedValue, setStoredValue] = useState(initialSnapshot.value);
  const [storageStatus, setStorageStatus] = useState(initialSnapshot);

  const setValue = useCallback((value) => {
    const result = controllerRef.current.update(value);
    setStorageStatus(result.snapshot);
    if (result.ok) setStoredValue(result.value);
    return result;
  }, []);

  return [storedValue, setValue, storageStatus];
}
