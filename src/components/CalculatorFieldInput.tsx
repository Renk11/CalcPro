import { useEffect, useMemo, useState } from 'react';
import { MAX_BUTTON_TEXT_LENGTH } from '../shared/types/calculator';
import type {
  ButtonActionType,
  CalculatorField,
  CalculatorFieldValue,
  CalculatorRequest,
  CalculatorUploadedFile,
  InputFieldSubtype,
} from '../shared/types/calculator';
import {
  buildBookingSlots,
  createBookingValue,
  getBookingMinDate,
  isBookingDateAllowed,
  isBookingDateSelectable,
  isBookingValue,
} from '../entities/calculator/booking';
import {
  evaluateFormulaExpression,
  formatResultNumber,
} from '../entities/calculator/model';
import { sanitizeHtml } from '../shared/html/sanitizeHtml';
import { sanitizeUserUrl } from '../shared/url';

interface CalculatorFieldInputProps {
  field: CalculatorField;
  value: CalculatorFieldValue;
  error?: string;
  onChange: (value: CalculatorFieldValue) => void;
  isFormValid?: boolean;
  onButtonAction?: (action: ButtonActionType, field: CalculatorField) => void;
  templateId?: string;
  bookingRequests?: CalculatorRequest[];
  isDesignMode?: boolean;
  onBookingFieldChange?: (patch: Partial<CalculatorField>) => void;
  template?: { basePrice: number; globalCoefficient: number; fields: CalculatorField[] };
  allValues?: Record<string, CalculatorFieldValue>;
  isCalculationTriggered?: boolean;
}

interface LocalizedDateTimeInputProps {
  value: string;
  type: 'date' | 'time';
  placeholder: string;
  className: string;
  onChange: (value: string) => void;
}

const bookingMonthFormatter = new Intl.DateTimeFormat('ru-RU', {
  month: 'long',
  year: 'numeric',
});

const bookingWeekdayLabels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const pad = (value: number) => String(value).padStart(2, '0');

const toIsoDate = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const normalizeSliderNumericValue = (field: CalculatorField, rawValue: unknown) => {
  const min = Number.isFinite(field.min) ? Number(field.min) : 0;
  const max = Number.isFinite(field.max) ? Number(field.max) : 100;
  const normalizedMin = Math.min(min, max);
  const normalizedMax = Math.max(min, max);
  const numericValue = Number(rawValue);

  if (!Number.isFinite(numericValue)) {
    return normalizedMin;
  }

  return clampNumber(numericValue, normalizedMin, normalizedMax);
};

const getSliderValue = (field: CalculatorField, value: CalculatorFieldValue) => {
  if (typeof value === 'number') {
    return normalizeSliderNumericValue(field, value);
  }

  if (typeof value === 'string' && value !== '') {
    return normalizeSliderNumericValue(field, value);
  }

  if (typeof field.defaultValue === 'number') {
    return normalizeSliderNumericValue(field, field.defaultValue);
  }

  return normalizeSliderNumericValue(field, field.min ?? 0);
};

const getInputSubtype = (field: CalculatorField): InputFieldSubtype | null => {
  if (field.type === 'input') {
    return field.inputSubtype ?? 'text';
  }

  if (field.type === 'number') {
    return 'number';
  }

  if (field.type === 'text') {
    return 'text';
  }

  return null;
};

const stopDesignModePropagation = (
  event: { stopPropagation: () => void },
  isDesignMode?: boolean,
) => {
  if (isDesignMode) {
    event.stopPropagation();
  }
};

const getDefaultInputPlaceholder = (inputSubtype: InputFieldSubtype) => {
  switch (inputSubtype) {
    case 'number':
      return 'Введите число';
    case 'phone':
      return '+7 (999) 123-45-67';
    case 'email':
      return 'primer@pochta.ru';
    case 'date':
      return 'дд.мм.гггг';
    case 'time':
      return 'чч:мм';
    case 'textarea':
      return 'Введите текст';
    case 'file':
      return 'Файл не выбран';
    default:
      return 'Введите текст';
  }
};

const normalizeDigits = (value: string) => value.replace(/\D/g, '');

const formatDateValue = (rawValue: string) => {
  const digits = normalizeDigits(rawValue).slice(0, 8);

  if (digits.length <= 2) {
    return digits;
  }

  if (digits.length <= 4) {
    return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  }

  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
};

const formatTimeValue = (rawValue: string) => {
  const digits = normalizeDigits(rawValue).slice(0, 4);

  if (digits.length === 0) {
    return '';
  }

  if (digits.length <= 2) {
    const hours = Number(digits);
    if (digits.length === 1 || hours <= 23) {
      return digits;
    }

    return `0${digits.slice(0, 1)}:${digits.slice(1)}`;
  }

  if (digits.length === 3) {
    const firstTwoHours = Number(digits.slice(0, 2));
    if (firstTwoHours <= 23) {
      return `${digits.slice(0, 2)}:${digits.slice(2)}`;
    }

    return `0${digits.slice(0, 1)}:${digits.slice(1)}`;
  }

  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
};

const parseDisplayDateToIso = (value: string) => {
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) {
    return '';
  }

  const [, day, month, year] = match;
  const isoValue = `${year}-${month}-${day}`;
  const date = new Date(`${isoValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return isoValue;
};

const formatIsoDateToDisplay = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return '';
  }

  const [, year, month, day] = match;
  return `${day}.${month}.${year}`;
};

const parseDisplayTimeToValue = (value: string) => {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return '';
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return '';
  }

  return `${pad(hours)}:${pad(minutes)}`;
};

const parseTimeToMinutes = (value: string) => {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
};

const getMonthStart = (isoDate?: string) => {
  const base = isoDate ? new Date(`${isoDate}T00:00:00`) : new Date();
  return new Date(base.getFullYear(), base.getMonth(), 1);
};

const getCalendarDays = (monthDate: Date) => {
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const lastDay = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
  const days: Date[] = [];
  const firstWeekday = (firstDay.getDay() + 6) % 7;

  for (let shift = firstWeekday; shift > 0; shift -= 1) {
    days.push(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1 - shift));
  }

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    days.push(new Date(monthDate.getFullYear(), monthDate.getMonth(), day));
  }

  while (days.length % 7 !== 0) {
    const nextDay = days.length - (firstDay.getDay() + lastDay.getDate()) + 1;
    days.push(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, nextDay));
  }

  return days;
};

const renderFieldHead = (field: CalculatorField) => (
  <span className="calc-field__head">
    <span className="calc-field__label">{field.label}</span>
    {field.required ? <span className="calc-field__required">Обязательно</span> : null}
  </span>
);

const isUploadedFileArray = (value: CalculatorFieldValue): value is CalculatorUploadedFile[] =>
  Array.isArray(value) && (value.length === 0 || typeof value[0] === 'object');

const clampTextFontSize = (value?: number) => Math.min(72, Math.max(10, value ?? 16));
const clampTextFontWeight = (value?: number) => Math.min(800, Math.max(300, value ?? 500));

const getTextStyleDefaults = (textStyle: NonNullable<CalculatorField['textStyle']>) => {
  switch (textStyle) {
    case 'title':
      return { fontSize: 32, fontWeight: 700, textColor: '#2e2620' };
    case 'subtitle':
      return { fontSize: 22, fontWeight: 600, textColor: '#4b3f34' };
    case 'hint':
      return { fontSize: 13, fontWeight: 400, textColor: '#8a7664' };
    case 'description':
    default:
      return { fontSize: 16, fontWeight: 500, textColor: '#6f5d4e' };
  }
};

const getImageBlockWidth = (size?: CalculatorField['imageSize']) => {
  switch (size) {
    case 'small':
      return '220px';
    case 'medium':
      return '320px';
    case 'full':
      return '100%';
    case 'large':
    default:
      return '460px';
  }
};

const getButtonText = (field: CalculatorField) => {
  if (field.buttonText?.trim()) {
    return field.buttonText.trim().slice(0, MAX_BUTTON_TEXT_LENGTH);
  }

  switch (field.buttonAction) {
    case 'submit':
      return 'Отправить заявку';
    case 'reset':
      return 'Сбросить форму';
    case 'link':
      return 'Перейти по ссылке';
    case 'vk':
      return 'Написать в ВК';
    case 'copy':
      return 'Скопировать результат';
    case 'calculate':
    default:
      return 'Рассчитать';
  }
};

const LocalizedDateTimeInput = ({
  value,
  type,
  placeholder,
  className,
  onChange,
}: LocalizedDateTimeInputProps) => {
  const [draftValue, setDraftValue] = useState(
    type === 'date' ? formatIsoDateToDisplay(value) : value,
  );

  useEffect(() => {
    setDraftValue(type === 'date' ? formatIsoDateToDisplay(value) : value);
  }, [type, value]);

  return (
    <input
      className={className}
      type="text"
      inputMode={type === 'time' ? 'numeric' : undefined}
      placeholder={placeholder}
      value={draftValue}
      onChange={(event) => {
        if (type === 'date') {
          const formatted = formatDateValue(event.target.value);
          setDraftValue(formatted);
          onChange(parseDisplayDateToIso(formatted));
          return;
        }

        const formatted = formatTimeValue(event.target.value);
        setDraftValue(formatted);
        onChange(parseDisplayTimeToValue(formatted));
      }}
    />
  );
};

export const CalculatorFieldInput = ({
  field,
  value,
  error,
  onChange,
  isFormValid = true,
  onButtonAction,
  templateId = '',
  bookingRequests = [],
  isDesignMode = false,
  onBookingFieldChange,
  template,
  allValues,
  isCalculationTriggered = true,
}: CalculatorFieldInputProps) => {
  const inputSubtype = getInputSubtype(field);
  const [selectedBookingDate, setSelectedBookingDate] = useState(() =>
    isBookingValue(value) ? value.date : getBookingMinDate(field),
  );
  const [bookingMonthDate, setBookingMonthDate] = useState(() =>
    getMonthStart(isBookingValue(value) ? value.date : getBookingMinDate(field)),
  );
  const [isBookingCalendarOpen, setIsBookingCalendarOpen] = useState(false);
  const [isCustomBookingTimeOpen, setIsCustomBookingTimeOpen] = useState(false);
  const [customBookingTimeDraft, setCustomBookingTimeDraft] = useState('');
  const [customBookingTimeError, setCustomBookingTimeError] = useState('');

  useEffect(() => {
    if (field.type !== 'booking') {
      return;
    }

    if (isBookingValue(value)) {
      setSelectedBookingDate(value.date);
      setBookingMonthDate(getMonthStart(value.date));
      return;
    }

    setSelectedBookingDate((current) => current || getBookingMinDate(field));
  }, [field, value]);

  useEffect(() => {
    setIsCustomBookingTimeOpen(false);
    setCustomBookingTimeDraft('');
    setCustomBookingTimeError('');
  }, [selectedBookingDate]);

  const formulaSource = template ?? null;
  const valuesSource = allValues ?? {};
  const visibilityCheck =
    formulaSource && field.visibilityCondition?.trim()
      ? evaluateFormulaExpression(field.visibilityCondition, formulaSource, valuesSource)
      : { value: 1, error: '' };
  const shouldHideField =
    !isDesignMode &&
    (field.hidden === true ||
      (Boolean(field.visibilityCondition?.trim()) && visibilityCheck.value === 0));

  if (shouldHideField) {
    return null;
  }

  const bookingDateAvailable = useMemo(
    () =>
      field.type === 'booking'
        ? isDesignMode
          ? isBookingDateAllowed(field, selectedBookingDate)
          : isBookingDateSelectable(field, selectedBookingDate, templateId, bookingRequests)
        : false,
    [bookingRequests, field, isDesignMode, selectedBookingDate, templateId],
  );

  const bookingSlots = useMemo(
    () =>
      field.type === 'booking'
        ? buildBookingSlots(field, selectedBookingDate, templateId, bookingRequests)
        : [],
    [bookingRequests, field, selectedBookingDate, templateId],
  );

  const bookingCalendarDays = useMemo(() => getCalendarDays(bookingMonthDate), [bookingMonthDate]);
  const isManualBookingSelected =
    field.type === 'booking' &&
    isBookingValue(value) &&
    bookingSlots.every((slot) => slot.dateTime !== value.dateTime);
  const handleCustomBookingSubmit = () => {
    if (field.type !== 'booking') {
      return;
    }

    const time = parseDisplayTimeToValue(customBookingTimeDraft);
    if (!time) {
      setCustomBookingTimeError('Введите время в формате чч:мм');
      return;
    }

    const selectedMinutes = parseTimeToMinutes(time);
    const startMinutes = parseTimeToMinutes(field.bookingStartTime ?? '09:00');
    const endMinutes = parseTimeToMinutes(field.bookingEndTime ?? '18:00');
    if (
      selectedMinutes === null ||
      startMinutes === null ||
      endMinutes === null ||
      selectedMinutes < startMinutes ||
      selectedMinutes >= endMinutes
    ) {
      setCustomBookingTimeError('Время должно попадать в рабочий диапазон');
      return;
    }

    const dateTime = `${selectedBookingDate}T${time}`;
    const bookingDateTime = new Date(`${dateTime}:00`);
    if (Number.isNaN(bookingDateTime.getTime()) || bookingDateTime.getTime() <= Date.now()) {
      setCustomBookingTimeError('Нужно выбрать будущее время');
      return;
    }

    const usageCount = bookingRequests.reduce((count, request) => {
      if (request.templateId !== templateId) {
        return count;
      }

      const rawValue = request.values[field.key];
      if (!isBookingValue(rawValue)) {
        return count;
      }

      return rawValue.dateTime === dateTime ? count + 1 : count;
    }, 0);
    const maxRequestsPerSlot =
      Number.isFinite(field.bookingMaxRequestsPerSlot) &&
      (field.bookingMaxRequestsPerSlot ?? 0) > 0
        ? Number(field.bookingMaxRequestsPerSlot)
        : 1;
    const nextCustomSlots = [...new Set([...(field.bookingCustomSlots ?? []), dateTime])].sort(
      (left, right) => left.localeCompare(right),
    );
    if (usageCount >= maxRequestsPerSlot) {
      setCustomBookingTimeError('Это время уже занято, выберите другое');
      return;
    }

    const urgentThresholdHours =
      Number.isFinite(field.bookingUrgentThresholdHours) &&
      (field.bookingUrgentThresholdHours ?? 0) > 0
        ? Number(field.bookingUrgentThresholdHours)
        : 24;
    const urgentSurcharge = Math.max(0, field.bookingUrgentSurcharge ?? 0);
    const isUrgent =
      urgentSurcharge > 0 &&
      bookingDateTime.getTime() - Date.now() <= urgentThresholdHours * 60 * 60 * 1000;

    onChange({
      date: selectedBookingDate,
      time,
      dateTime,
      label: `${selectedBookingDate} ${time}`,
      surcharge: isUrgent ? urgentSurcharge : 0,
      isUrgent,
    });
    if (isDesignMode) {
      onBookingFieldChange?.({ bookingCustomSlots: nextCustomSlots });
    }
    setCustomBookingTimeError('');
    setIsCustomBookingTimeOpen(false);
    setIsBookingCalendarOpen(false);
  };

  if (field.type === 'result') {
    if (isDesignMode) {
      return (
        <div className="calc-field calc-field_result">
          {renderFieldHead(field)}
          {field.description ? <span className="calc-field__description">{field.description}</span> : null}
          <div className="calc-result-block">
            <div className="calc-result-block__placeholder">Настраивается в режиме «Формула»</div>
          </div>
        </div>
      );
    }

    const evaluation = formulaSource
      ? evaluateFormulaExpression(field.resultFormula ?? '', formulaSource, valuesSource)
      : { value: 0, error: 'Результат недоступен' };
    const visibilityCheck =
      formulaSource && field.resultVisibilityCondition?.trim()
        ? evaluateFormulaExpression(field.resultVisibilityCondition, formulaSource, valuesSource)
        : { value: 1, error: '' };
    const shouldHideByCondition = Boolean(field.resultVisibilityCondition?.trim()) && visibilityCheck.value === 0;
    const shouldWaitForButton =
      !isDesignMode &&
      (field.resultDisplayMode ?? 'auto') === 'after_button' &&
      !isCalculationTriggered;

    if (shouldHideByCondition || shouldWaitForButton) {
      return null;
    }

    const decimals = Math.min(6, Math.max(0, field.resultDecimals ?? 0));
    const normalizedValue =
      field.resultRounding === false
        ? evaluation.value
        : Number(evaluation.value.toFixed(decimals));
    const formattedValue = formatResultNumber(
      normalizedValue,
      field.resultRounding === false ? decimals : 0,
      field.resultFormat ?? 'space',
    );

    return (
      <div className="calc-field calc-field_result">
        {renderFieldHead(field)}
        {field.description ? <span className="calc-field__description">{field.description}</span> : null}
        <div className="calc-result-block">
          {evaluation.error ? (
            <div className="calc-result-block__error">{evaluation.error}</div>
          ) : (
            <div className="calc-result-block__value">
              {(field.resultPrefix ?? '') + formattedValue + (field.resultSuffix ?? '')}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (field.type === 'html') {
    const sanitizedHtml = sanitizeHtml(field.htmlContent ?? '');

    if (!sanitizedHtml) {
      return isDesignMode ? (
        <div className="calc-field calc-field_html">
          <div className="calc-html-block calc-html-block_empty">Добавьте HTML-код</div>
        </div>
      ) : null;
    }

    return (
      <div className="calc-field calc-field_html">
        <div
          className="calc-html-block"
          dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
        />
      </div>
    );
  }

  if (field.type === 'text' && field.textStyle) {
    const content = field.content?.trim() || field.label;
    const safeLinkUrl = sanitizeUserUrl(field.linkUrl);
    const defaults = getTextStyleDefaults(field.textStyle);
    const style = {
      color: field.textColor ?? defaults.textColor,
      fontSize: `${clampTextFontSize(field.fontSize ?? defaults.fontSize)}px`,
      fontWeight: clampTextFontWeight(field.fontWeight ?? defaults.fontWeight),
      textAlign: field.textAlign ?? 'left',
    } as const;

    const body = safeLinkUrl ? (
      <a className="calc-text-block__link" href={safeLinkUrl} target="_blank" rel="noreferrer">
        {content}
      </a>
    ) : (
      content
    );

    return (
      <div className={`calc-text-block calc-text-block_${field.textStyle}`} style={style}>
        {body}
      </div>
    );
  }

  if (field.type === 'image') {
    const imageUrl = field.imageUrl?.trim();
    const imageAlt = field.imageAlt?.trim() || field.label;
    const align = field.imageAlign ?? 'center';
    const radius = Math.min(40, Math.max(0, field.imageRadius ?? 24));

    return (
      <figure
        className={`calc-image-block calc-image-block_${align}`}
        style={{
          ['--image-radius' as string]: `${radius}px`,
          ['--image-width' as string]: getImageBlockWidth(field.imageSize),
        }}
      >
        {imageUrl ? (
          <div className={`calc-image-block__media calc-image-block__media_${field.imageFit ?? 'cover'}`}>
            <img className="calc-image-block__img" src={imageUrl} alt={imageAlt} />
          </div>
        ) : (
          <div className="calc-image-block__empty">Загрузите изображение</div>
        )}
        {field.imageCaption ? (
          <figcaption className="calc-image-block__caption">{field.imageCaption}</figcaption>
        ) : null}
      </figure>
    );
  }

  if (field.type === 'button') {
    if (field.buttonShowWhenValid && !isFormValid) {
      return null;
    }

    const buttonColor = field.buttonColor ?? 'accent';
    const buttonSize = field.buttonSize ?? 'medium';
    const buttonWidth = field.buttonWidth ?? 'auto';
    const buttonRadius = Math.min(32, Math.max(0, field.buttonRadius ?? 18));
    const isLoading = field.buttonLoading === true;

    return (
      <div className={`calc-action-button-wrap calc-action-button-wrap_${buttonWidth}`}>
        <button
          className={`calc-action-button calc-action-button_${buttonColor} calc-action-button_${buttonSize} calc-action-button_${buttonWidth}`}
          type="button"
          style={{ ['--button-radius' as string]: `${buttonRadius}px` }}
          disabled={isLoading}
          onClick={() => onButtonAction?.(field.buttonAction ?? 'calculate', field)}
        >
          {isLoading ? 'Загрузка...' : getButtonText(field)}
        </button>
      </div>
    );
  }

  if (field.type === 'booking') {
    const selectedBookingValue = isBookingValue(value) ? value : null;
    const bookingDateLabel = selectedBookingDate
      ? formatIsoDateToDisplay(selectedBookingDate)
      : 'Выберите дату';

    return (
      <div className="calc-field calc-field_booking">
        {renderFieldHead(field)}
        {field.description ? <span className="calc-field__description">{field.description}</span> : null}
        {field.hint ? <span className="calc-field__hint">{field.hint}</span> : null}

        <div
          className={`calc-field__booking-trigger ${error && !selectedBookingValue ? 'calc-field__booking-trigger_error' : ''}`}
        >
          <span className="calc-field__booking-trigger-copy">
            <span className="calc-field__booking-trigger-label">Дата записи</span>
            <span className="calc-field__booking-trigger-value">
              {selectedBookingValue
                ? `${bookingDateLabel}, ${selectedBookingValue.time}`
                : bookingDateLabel}
            </span>
          </span>
          <button
            className="calc-field__booking-trigger-button"
            type="button"
            onClick={() => setIsBookingCalendarOpen((current) => !current)}
          >
            Календарь
          </button>
        </div>

        {!isDesignMode && !bookingDateAvailable ? (
          <div className="calc-field__booking-note">
            На выбранную дату нет доступных слотов. Попробуйте другой день.
          </div>
        ) : null}

        {selectedBookingValue ? (
          <div className="calc-field__booking-summary">
            Выбрано: {selectedBookingValue.label}
            {selectedBookingValue.surcharge > 0
              ? `, срочная запись +${selectedBookingValue.surcharge} ₽`
              : ''}
          </div>
        ) : null}

        {error ? <span className="calc-field__error">{error}</span> : null}

        {isBookingCalendarOpen ? (
          <div className="calc-booking-modal" role="dialog" aria-modal="true">
            <div
              className="calc-booking-modal__backdrop"
              onClick={() => setIsBookingCalendarOpen(false)}
            />
            <div className="calc-booking-modal__card">
              <div className="calc-booking-modal__head">
                <div>
                  <div className="calc-booking-modal__eyebrow">Выбор даты</div>
                  <h3 className="calc-booking-modal__title">Дата записи</h3>
                </div>
                <button
                  className="calc-booking-modal__close"
                  type="button"
                  onClick={() => setIsBookingCalendarOpen(false)}
                >
                  Закрыть
                </button>
              </div>

              <div className="calc-booking-modal__body">
                <div className="calc-field__booking-calendar">
                  <div className="calc-field__booking-calendar-head">
                    <button
                      className="calc-field__booking-calendar-nav"
                      type="button"
                      onClick={() =>
                        setBookingMonthDate(
                          new Date(
                            bookingMonthDate.getFullYear(),
                            bookingMonthDate.getMonth() - 1,
                            1,
                          ),
                        )
                      }
                    >
                      ←
                    </button>
                    <strong className="calc-field__booking-calendar-title">
                      {bookingMonthFormatter.format(bookingMonthDate)}
                    </strong>
                    <button
                      className="calc-field__booking-calendar-nav"
                      type="button"
                      onClick={() =>
                        setBookingMonthDate(
                          new Date(
                            bookingMonthDate.getFullYear(),
                            bookingMonthDate.getMonth() + 1,
                            1,
                          ),
                        )
                      }
                    >
                      →
                    </button>
                  </div>

                  <div className="calc-field__booking-calendar-grid calc-field__booking-calendar-grid_weekdays">
                    {bookingWeekdayLabels.map((day) => (
                      <span key={day} className="calc-field__booking-calendar-weekday">
                        {day}
                      </span>
                    ))}
                  </div>

                  <div className="calc-field__booking-calendar-grid">
                    {bookingCalendarDays.map((day) => {
                      const isoDate = toIsoDate(day);
                      const isCurrentMonth = day.getMonth() === bookingMonthDate.getMonth();
                      const isSelected = selectedBookingDate === isoDate;
                      const isSelectable =
                        isCurrentMonth &&
                        (isDesignMode
                          ? isBookingDateAllowed(field, isoDate)
                          : isBookingDateSelectable(field, isoDate, templateId, bookingRequests));

                      return (
                        <button
                          key={isoDate}
                          className={`calc-field__booking-calendar-day ${isSelected ? 'calc-field__booking-calendar-day_active' : ''} ${!isCurrentMonth ? 'calc-field__booking-calendar-day_muted' : ''}`}
                          type="button"
                          disabled={!isSelectable}
                          onClick={() => {
                            setSelectedBookingDate(isoDate);
                            if (selectedBookingValue?.date !== isoDate) {
                              onChange('');
                            }
                          }}
                        >
                          {day.getDate()}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="calc-booking-modal__slots">
                  <div className="calc-booking-modal__slots-title">Доступное время</div>
                  <div className="calc-field__booking-slots">
                    {isDesignMode ? (
                      <button
                        className={`calc-field__booking-slot calc-field__booking-slot_add ${isCustomBookingTimeOpen || isManualBookingSelected ? 'calc-field__booking-slot_active' : ''}`}
                        type="button"
                        onClick={() => {
                          setIsCustomBookingTimeOpen((current) => !current);
                          setCustomBookingTimeError('');
                        }}
                      >
                        <span className="calc-field__booking-slot-plus">+</span>
                        <span className="calc-field__booking-slot-meta">Добавить время</span>
                      </button>
                    ) : null}
                    {bookingSlots.map((slot) => {
                      const isSelected = selectedBookingValue?.dateTime === slot.dateTime;

                      return (
                        <button
                          key={slot.dateTime}
                          className={`calc-field__booking-slot ${isSelected ? 'calc-field__booking-slot_active' : ''}`}
                          type="button"
                          disabled={!slot.isAvailable && !isDesignMode}
                          onClick={() => {
                            onChange(createBookingValue(slot));
                            if (!isDesignMode) {
                              setIsBookingCalendarOpen(false);
                            }
                          }}
                        >
                          <span>{slot.time}</span>
                          {slot.surcharge > 0 ? (
                            <span className="calc-field__booking-slot-meta">
                              +{slot.surcharge} ₽
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  {bookingSlots.length === 0 ? (
                    <div className="calc-booking-modal__slots-empty">
                      {isDesignMode
                        ? 'На выбранную дату пока нет добавленных слотов.'
                        : 'На выбранную дату пока нет доступного времени.'}
                    </div>
                  ) : null}
                  {isDesignMode && isCustomBookingTimeOpen ? (
                    <div className="calc-field__booking-custom">
                      <input
                        className="calc-field__booking-custom-input"
                        type="text"
                        inputMode="numeric"
                        placeholder="чч:мм"
                        value={customBookingTimeDraft}
                        onChange={(event) => {
                          setCustomBookingTimeDraft(formatTimeValue(event.target.value));
                          setCustomBookingTimeError('');
                        }}
                      />
                      <button
                        className="calc-field__booking-custom-button"
                        type="button"
                        onClick={handleCustomBookingSubmit}
                      >
                        Добавить
                      </button>
                    </div>
                  ) : null}
                  {isDesignMode && customBookingTimeError ? (
                    <div className="calc-field__booking-custom-error">{customBookingTimeError}</div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (field.type === 'radio') {
    const selectedValue = String(value ?? '');
    const optionLayout = field.optionLayout === 'horizontal' ? 'horizontal' : 'vertical';

    return (
      <div className="calc-field calc-field_radio">
        {renderFieldHead(field)}
        {field.description ? <span className="calc-field__description">{field.description}</span> : null}
        {field.placeholder ? <span className="calc-field__hint">{field.placeholder}</span> : null}

        <div className={`calc-field__radio-list calc-field__radio-list_${optionLayout}`}>
          {(field.options ?? []).map((option) => {
            const isChecked = selectedValue === String(option.value);
            const optionPrice =
              typeof option.value === 'number' ? `${option.value} ₽` : String(option.value);
            const optionDescription = field.showOptionDescription ? option.description?.trim() ?? '' : '';
            const showOptionPrice = Boolean(field.showOptionPrice) && optionPrice.trim() !== '';

            return (
              <label
                key={option.id}
                className={`calc-field__radio-option ${isChecked ? 'calc-field__radio-option_active' : ''}`}
              >
                <input
                  className="calc-field__radio-input"
                  type="radio"
                  name={field.id}
                  checked={isChecked}
                  onChange={() => onChange(option.value)}
                />
                <span className="calc-field__radio-mark" />
                <span className="calc-field__radio-copy">
                  <span className="calc-field__radio-label">{option.label}</span>
                  {optionDescription ? <span className="calc-field__radio-meta">{optionDescription}</span> : null}
                  {showOptionPrice ? <span className="calc-field__radio-price">{optionPrice}</span> : null}
                </span>
              </label>
            );
          })}
        </div>

        {error ? <span className="calc-field__error">{error}</span> : null}
      </div>
    );
  }


  if (field.type === 'checkbox') {
    const rawPrice =
      typeof field.onValue === 'number' ? field.onValue : Number(field.onValue ?? Number.NaN);
    const checkboxText = field.checkboxLabel || '\u0412\u043a\u043b\u044e\u0447\u0438\u0442\u044c \u043e\u043f\u0446\u0438\u044e';
    const checkboxPrice =
      field.showPriceInline && Number.isFinite(rawPrice) ? ` (${rawPrice} \u20bd)` : '';
    const hasExtraRows = (field.options?.length ?? 0) > 0;
    const selectedIds = Array.isArray(value) ? value.map(String) : value ? ['__primary__'] : [];
    const checkboxRows = [
      {
        id: '__primary__',
        label: checkboxText,
        price: checkboxPrice,
      },
      ...(field.options ?? []).map((option) => ({
        id: option.id,
        label: option.label,
        price:
          field.showPriceInline && typeof option.value === 'number' ? ` (${option.value} \u20bd)` : '',
      })),
    ];

    return (
      <div className="calc-field calc-field_checkbox">
        {renderFieldHead(field)}
        {field.description ? <span className="calc-field__description">{field.description}</span> : null}
        {field.placeholder ? <span className="calc-field__hint">{field.placeholder}</span> : null}
        {checkboxRows.map((row) => {
          const isChecked = hasExtraRows ? selectedIds.includes(row.id) : Boolean(value);

          return (
            <label key={row.id} className="calc-field__checkbox-row">
              <input
                className="calc-field__checkbox"
                type="checkbox"
                checked={isChecked}
                onChange={(event) => {
                  if (!hasExtraRows) {
                    onChange(event.target.checked);
                    return;
                  }

                  const nextSelectedIds = event.target.checked
                    ? [...selectedIds, row.id]
                    : selectedIds.filter((item) => item !== row.id);
                  onChange(nextSelectedIds);
                }}
              />
              <span className="calc-field__checkbox-text">{`${row.label}${row.price}`}</span>
            </label>
          );
        })}
        {error ? <span className="calc-field__error">{error}</span> : null}
      </div>
    );
  }

  if (field.type === 'select') {
    return (
      <label className="calc-field">
        {renderFieldHead(field)}
        {field.description ? <span className="calc-field__description">{field.description}</span> : null}
        <select
          className={`calc-field__control ${error ? 'calc-field__control_error' : ''}`}
          value={value === false ? '' : String(value ?? '')}
          onChange={(event) => {
            const option = field.options?.find((item) => String(item.value) === event.target.value);
            onChange(option?.value ?? '');
          }}
        >
          <option value="">{field.placeholder || 'Выберите значение'}</option>
          {(field.options ?? []).map((option) => {
            const hasPrice = field.showOptionPrices && typeof option.value === 'number';
            const optionLabel = hasPrice ? `${option.label} — ${option.value} ₽` : option.label;

            return (
              <option key={option.id} value={String(option.value)}>
                {optionLabel}
              </option>
            );
          })}
        </select>
        {error ? <span className="calc-field__error">{error}</span> : null}
      </label>
    );
  }

  if (field.type === 'slider') {
    const sliderValue = getSliderValue(field, value);
    const min = field.min ?? 0;
    const max = field.max ?? 100;
    const step = field.step ?? 1;
    const unit = field.unit ? ` ${field.unit}` : '';

    return (
      <div className="calc-field calc-field_slider">
        {renderFieldHead(field)}
        {field.description ? <span className="calc-field__description">{field.description}</span> : null}
        {field.placeholder ? <span className="calc-field__hint">{field.placeholder}</span> : null}

        {field.showCurrentValue ? (
          <div className="calc-field__slider-value">
            {sliderValue}
            {unit}
          </div>
        ) : null}

        <div className="calc-field__slider-row">
          {field.showScale !== false ? (
            <input
              className="calc-field__slider"
              type="range"
              min={min}
              max={max}
              step={step}
              value={sliderValue}
              onPointerDown={(event) => stopDesignModePropagation(event, isDesignMode)}
              onClick={(event) => stopDesignModePropagation(event, isDesignMode)}
              onFocus={(event) => stopDesignModePropagation(event, isDesignMode)}
              onChange={(event) => onChange(Number(event.target.value))}
            />
          ) : null}

          {field.allowManualInput ? (
            <input
              className={`calc-field__control calc-field__slider-input ${error ? 'calc-field__control_error' : ''}`}
              type="number"
              min={min}
              max={max}
              step={step}
              value={sliderValue}
              placeholder={field.placeholder || 'Введите число'}
              onPointerDown={(event) => stopDesignModePropagation(event, isDesignMode)}
              onClick={(event) => stopDesignModePropagation(event, isDesignMode)}
              onFocus={(event) => stopDesignModePropagation(event, isDesignMode)}
              onChange={(event) =>
                onChange(
                  event.target.value === ''
                    ? min
                    : normalizeSliderNumericValue(field, event.target.value),
                )
              }
            />
          ) : null}
        </div>

        {field.showScale ? (
          <div className="calc-field__slider-scale">
            <span>{field.hideScaleNumbers ? '' : `${min}${unit}`}</span>
            <span>{field.hideScaleNumbers ? '' : `${max}${unit}`}</span>
          </div>
        ) : null}

        {error ? <span className="calc-field__error">{error}</span> : null}
      </div>
    );
  }

  if (inputSubtype) {
    const isTextarea = inputSubtype === 'textarea';
    const isFile = inputSubtype === 'file';
    const isNumber = inputSubtype === 'number';
    const inputType =
      inputSubtype === 'phone'
        ? 'tel'
        : inputSubtype === 'textarea' || inputSubtype === 'file'
          ? 'text'
          : inputSubtype;

    return (
      <label className="calc-field">
        {renderFieldHead(field)}
        {field.description ? <span className="calc-field__description">{field.description}</span> : null}
        {field.hint ? <span className="calc-field__hint">{field.hint}</span> : null}

        {isTextarea ? (
          <textarea
            className={`calc-field__control calc-field__control_textarea ${error ? 'calc-field__control_error' : ''}`}
            value={String(value ?? '')}
            placeholder={field.placeholder || getDefaultInputPlaceholder(inputSubtype)}
            minLength={field.minLength}
            maxLength={field.maxLength}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : isFile ? (
          <span className={`calc-field__file ${error ? 'calc-field__file_error' : ''}`}>
            <input
              className="calc-field__file-input"
              type="file"
              accept={field.fileAccept}
              onChange={(event) =>
                onChange(
                  Array.from(event.target.files ?? []).map((file) => ({
                    name: file.name,
                    size: file.size,
                    type: file.type,
                  })),
                )
              }
            />
            <span className="calc-field__file-button">Выбрать файл</span>
            <span className="calc-field__file-text">
              {isUploadedFileArray(value) && value.length > 0
                ? value.map((file) => file.name).join(', ')
                : 'Файл не выбран'}
            </span>
          </span>
        ) : inputSubtype === 'date' || inputSubtype === 'time' ? (
          <LocalizedDateTimeInput
            className={`calc-field__control ${error ? 'calc-field__control_error' : ''}`}
            type={inputSubtype}
            placeholder={field.placeholder || getDefaultInputPlaceholder(inputSubtype)}
            value={String(value ?? '')}
            onChange={(nextValue) => onChange(nextValue)}
          />
        ) : (
          <input
            className={`calc-field__control ${error ? 'calc-field__control_error' : ''}`}
            type={inputType}
            value={isNumber ? (value === 0 ? '' : String(value ?? '')) : String(value ?? '')}
            placeholder={field.placeholder || getDefaultInputPlaceholder(inputSubtype)}
            min={isNumber ? field.min : undefined}
            max={isNumber ? field.max : undefined}
            step={isNumber ? field.step : undefined}
            minLength={!isNumber ? field.minLength : undefined}
            maxLength={!isNumber ? field.maxLength : undefined}
            onChange={(event) =>
              onChange(
                isNumber
                  ? event.target.value === ''
                    ? ''
                    : Number(event.target.value)
                  : event.target.value,
              )
            }
          />
        )}

        {error ? <span className="calc-field__error">{error}</span> : null}
      </label>
    );
  }

  return (
    <label className="calc-field">
      {renderFieldHead(field)}
      {field.description ? <span className="calc-field__description">{field.description}</span> : null}
      <input
        className={`calc-field__control ${error ? 'calc-field__control_error' : ''}`}
        type="number"
        value={value === 0 ? '' : String(value ?? '')}
        placeholder={field.placeholder || 'Введите число'}
        onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
      />
      {error ? <span className="calc-field__error">{error}</span> : null}
    </label>
  );
};
