import { getStorageItem, removeStorageItem, setStorageItem } from './safeStorage';

type PendingPaymentRecord = {
  paymentId?: string;
};

export const PENDING_PAYMENT_STORAGE_KEY = 'vk-community-calculator/pending-yookassa-payment';

export const readPendingPayment = (): PendingPaymentRecord | null => {
  const rawValue = getStorageItem(PENDING_PAYMENT_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as PendingPaymentRecord;
  } catch {
    removeStorageItem(PENDING_PAYMENT_STORAGE_KEY);
    return null;
  }
};

export const writePendingPayment = (paymentId: string) => {
  setStorageItem(PENDING_PAYMENT_STORAGE_KEY, JSON.stringify({ paymentId }));
};

export const clearPendingPayment = () => {
  removeStorageItem(PENDING_PAYMENT_STORAGE_KEY);
};
