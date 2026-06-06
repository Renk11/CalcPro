import type {
  CalculatorBookingValue,
  CalculatorField,
  CalculatorFieldValue,
  CalculatorRequest,
} from '../../shared/types/calculator';

export interface BookingSlot {
  date: string;
  time: string;
  dateTime: string;
  label: string;
  isUrgent: boolean;
  surcharge: number;
  usageCount: number;
  isAvailable: boolean;
}

const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5];
const DEFAULT_START_TIME = '09:00';
const DEFAULT_END_TIME = '18:00';
const DEFAULT_MAX_REQUESTS = 1;
const DEFAULT_URGENT_THRESHOLD_HOURS = 24;

const pad = (value: number) => String(value).padStart(2, '0');

export const toIsoDate = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const formatBookingLabel = (date: string, time: string) => `${date} ${time}`;

export const isBookingValue = (
  value: CalculatorFieldValue | undefined,
): value is CalculatorBookingValue =>
  Boolean(value) &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  'date' in value &&
  'time' in value &&
  'dateTime' in value;

export const getBookingWeekdays = (field: CalculatorField) =>
  (field.bookingWeekdays?.length ? field.bookingWeekdays : DEFAULT_WEEKDAYS).filter(
    (day) => day >= 0 && day <= 6,
  );

const parseTimeToMinutes = (value?: string) => {
  const [hours, minutes] = (value ?? '').split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }
  return hours * 60 + minutes;
};

const clampPositive = (value: number | undefined, fallback: number) =>
  Number.isFinite(value) && (value ?? 0) > 0 ? Number(value) : fallback;

const normalizeBookingSlotDateTimes = (slots: string[] = []) =>
  [...new Set(slots.filter((slot) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(slot)))].sort((a, b) =>
    a.localeCompare(b),
  );

export const getBookingMinDate = (field: CalculatorField, now = new Date()) =>
  field.bookingMinDate?.trim() || toIsoDate(now);

export const getBookingMaxDate = (field: CalculatorField, now = new Date()) => {
  if (field.bookingMaxDate?.trim()) {
    return field.bookingMaxDate;
  }

  const maxDate = new Date(now);
  maxDate.setDate(maxDate.getDate() + 30);
  return toIsoDate(maxDate);
};

const getSlotUsageCount = (
  templateId: string,
  fieldKey: string,
  dateTime: string,
  requests: CalculatorRequest[],
) =>
  requests.reduce((count, request) => {
    if (request.templateId !== templateId) {
      return count;
    }

    const rawValue = request.values[fieldKey];
    if (!isBookingValue(rawValue)) {
      return count;
    }

    return rawValue.dateTime === dateTime ? count + 1 : count;
  }, 0);

export const buildBookingSlots = (
  field: CalculatorField,
  date: string,
  templateId: string,
  requests: CalculatorRequest[],
  now = new Date(),
): BookingSlot[] => {
  if (!date) {
    return [];
  }

  const startMinutes =
    parseTimeToMinutes(field.bookingStartTime) ?? parseTimeToMinutes(DEFAULT_START_TIME)!;
  const endMinutes =
    parseTimeToMinutes(field.bookingEndTime) ?? parseTimeToMinutes(DEFAULT_END_TIME)!;
  const maxRequestsPerSlot = clampPositive(
    field.bookingMaxRequestsPerSlot,
    DEFAULT_MAX_REQUESTS,
  );
  const urgentThresholdHours = clampPositive(
    field.bookingUrgentThresholdHours,
    DEFAULT_URGENT_THRESHOLD_HOURS,
  );
  const urgentSurcharge = Math.max(0, field.bookingUrgentSurcharge ?? 0);

  if (startMinutes >= endMinutes) {
    return [];
  }

  return normalizeBookingSlotDateTimes(field.bookingCustomSlots)
    .filter((slotDateTime) => slotDateTime.startsWith(`${date}T`))
    .map((dateTime) => {
      const time = dateTime.slice(11, 16);
      const slotMinutes = parseTimeToMinutes(time);
      const isWithinWorkingHours =
        slotMinutes !== null && slotMinutes >= startMinutes && slotMinutes < endMinutes;
      if (!isWithinWorkingHours) {
        return null;
      }

      const slotDate = new Date(`${dateTime}:00`);
      const usageCount = getSlotUsageCount(templateId, field.key, dateTime, requests);
      const isUrgent =
        urgentSurcharge > 0 &&
        slotDate.getTime() - now.getTime() <= urgentThresholdHours * 60 * 60 * 1000;

      return {
        date,
        time,
        dateTime,
        label: formatBookingLabel(date, time),
        surcharge: isUrgent ? urgentSurcharge : 0,
        isUrgent,
        usageCount,
        isAvailable: slotDate.getTime() > now.getTime() && usageCount < maxRequestsPerSlot,
      } satisfies BookingSlot;
    })
    .filter((slot): slot is BookingSlot => slot !== null);
};

export const isBookingDateAllowed = (field: CalculatorField, date: string, now = new Date()) => {
  const excludedDates = new Set((field.bookingExcludedDates ?? []).filter(Boolean));
  if (excludedDates.has(date)) {
    return false;
  }

  const currentDate = new Date(`${date}T00:00:00`);
  if (Number.isNaN(currentDate.getTime())) {
    return false;
  }

  if (!getBookingWeekdays(field).includes(currentDate.getDay())) {
    return false;
  }

  const minDate = getBookingMinDate(field, now);
  const maxDate = getBookingMaxDate(field, now);
  if (date < minDate || date > maxDate) {
    return false;
  }

  const startMinutes =
    parseTimeToMinutes(field.bookingStartTime) ?? parseTimeToMinutes(DEFAULT_START_TIME)!;
  const endMinutes =
    parseTimeToMinutes(field.bookingEndTime) ?? parseTimeToMinutes(DEFAULT_END_TIME)!;

  return startMinutes < endMinutes;
};

export const isBookingDateSelectable = (
  field: CalculatorField,
  date: string,
  templateId: string,
  requests: CalculatorRequest[],
  now = new Date(),
) => {
  if (!isBookingDateAllowed(field, date, now)) {
    return false;
  }

  return buildBookingSlots(field, date, templateId, requests, now).some((slot) => slot.isAvailable);
};

export const createBookingValue = (slot: BookingSlot): CalculatorBookingValue => ({
  date: slot.date,
  time: slot.time,
  dateTime: slot.dateTime,
  label: slot.label,
  surcharge: slot.surcharge,
  isUrgent: slot.isUrgent,
});
