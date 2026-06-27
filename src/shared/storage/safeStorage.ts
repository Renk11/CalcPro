const memoryStorage = new Map<string, string>();

const getBrowserStorage = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const getStorageItem = (key: string) => {
  const storage = getBrowserStorage();
  if (!storage) {
    return memoryStorage.get(key) ?? null;
  }

  try {
    return storage.getItem(key);
  } catch {
    return memoryStorage.get(key) ?? null;
  }
};

export const setStorageItem = (key: string, value: string) => {
  memoryStorage.set(key, value);

  const storage = getBrowserStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(key, value);
  } catch {
    // Keep the in-memory fallback when persistent storage is unavailable.
  }
};

export const removeStorageItem = (key: string) => {
  memoryStorage.delete(key);

  const storage = getBrowserStorage();
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(key);
  } catch {
    // Ignore storage removal errors in restricted iframe environments.
  }
};

export const clearStorageByPrefix = (prefix: string) => {
  [...memoryStorage.keys()]
    .filter((key) => key.startsWith(prefix))
    .forEach((key) => {
      memoryStorage.delete(key);
    });

  const storage = getBrowserStorage();
  if (!storage) {
    return;
  }

  try {
    const keysToRemove: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && key.startsWith(prefix)) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => storage.removeItem(key));
  } catch {
    // Ignore storage cleanup errors in restricted iframe environments.
  }
};
