import { useEffect, useMemo, useRef, useState } from 'react';
import { useLayoutEffect } from 'react';
import {
  Icon20AddSquareOutline,
  Icon20ArrowLeftOutline,
  Icon20BracketsSlashOutline,
  Icon20CalendarCheckOutline,
  Icon20CheckBoxOff,
  Icon20CheckSquareOutline,
  Icon20DocumentStatsOutline,
  Icon20ListPlusOutline,
  Icon20PictureOnSquareOutline,
  Icon20SlidersOutline,
  Icon20SquareSplit4Outline,
  Icon20TextTtOutline,
} from '@vkontakte/icons';
import { CalculatorFieldInput } from '../components/CalculatorFieldInput';
import {
  buildFormulaContext,
  calculateTemplate,
  clampTemplateDescription,
  clampTemplateTitle,
  createDefaultRequestFormSettings,
  createEmptyTemplate,
  evaluateFormulaExpression,
  formatResultNumber,
  MAX_FORMULA_EXPRESSION_LENGTH,
  MAX_TEMPLATE_DESCRIPTION_LENGTH,
  MAX_TEMPLATE_TITLE_LENGTH,
} from '../entities/calculator/model';
import type {
  ButtonActionType,
  CalculatorField,
  CalculatorFieldOption,
  FormulaEditorMode,
  CalculatorTemplate,
  CalculatorValues,
  FieldType,
  InputFieldSubtype,
  VisualFormulaToken,
  VisualFormulaTokenType,
} from '../shared/types/calculator';
import { MAX_BUTTON_TEXT_LENGTH } from '../shared/types/calculator';
import { legalDocs, type LegalDocKey } from '../shared/legal';
import { sanitizeHtml } from '../shared/html/sanitizeHtml';
import { createRandomId } from '../shared/randomId';
import { normalizeTemplateRecord } from '../shared/storage/localStorage';

interface BuilderPageProps {
  initialTemplate?: CalculatorTemplate;
  onBack: () => void;
  onSave: (template: CalculatorTemplate) => void;
  canUseBooking?: boolean;
  canUseProFeatures?: boolean;
  isMonetizationRestricted?: boolean;
}

interface LocalizedBuilderDateTimeInputProps {
  type: 'date' | 'time';
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}

const BUILDER_AUTOSAVE_STORAGE_KEY = 'calcpro-builder-autosave-enabled';
const REQUEST_FORM_SELECTION_ID = '__request_form__';
const RESULT_CARD_SELECTION_ID = '__result_card__';
const PRO_LIBRARY_ITEM_IDS = new Set(['range', 'flag', 'image', 'booking', 'html']);
const BASIC_BUTTON_ACTIONS: ButtonActionType[] = ['calculate', 'submit', 'reset'];
const PREVIEW_DEVICE_CONFIG = {
  desktop: { label: 'ПК', width: '100%', height: null },
  tablet: { label: 'Планшет', width: 834, height: 1112 },
  mobile: { label: 'Телефон', width: 360, height: 780 },
} as const;
const MAX_FIELD_LABEL_LENGTH = 48;
const MAX_FIELD_DESCRIPTION_LENGTH = 120;
const MAX_FIELD_PLACEHOLDER_LENGTH = 64;
const MAX_FIELD_HINT_LENGTH = 80;
const MAX_OPTION_LABEL_LENGTH = 48;
const MAX_OPTION_DESCRIPTION_LENGTH = 80;
const MAX_CHECKBOX_LABEL_LENGTH = 80;
const MAX_RESULT_CARD_TITLE_LENGTH = 48;
const MAX_RESULT_CARD_LABEL_LENGTH = 32;
const MAX_REQUEST_FORM_TITLE_LENGTH = 48;
const MAX_REQUEST_FORM_DESCRIPTION_LENGTH = 120;
const MAX_REQUEST_FORM_LABEL_LENGTH = 48;
const MAX_REQUEST_FORM_PLACEHOLDER_LENGTH = 64;
const MAX_CALCULATION_PRICE = 1_000_000_000;
const MAX_CALCULATION_DISCOUNT = 100;
const MAX_CALCULATION_COEFFICIENT = 1_000;
const MAX_CALCULATION_FIELD_LENGTH = 16;
const MAX_FIELD_MARGIN = 200;
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;

const clampTextValue = (value: string, maxLength: number) => value.slice(0, maxLength);

const normalizeHexColor = (value: string | undefined, fallback: string) => {
  const normalizedValue = value?.trim();
  if (!normalizedValue || !HEX_COLOR_PATTERN.test(normalizedValue)) {
    return fallback;
  }

  if (normalizedValue.length === 4) {
    const [, red, green, blue] = normalizedValue;
    return `#${red}${red}${green}${green}${blue}${blue}`.toLowerCase();
  }

  return normalizedValue.toLowerCase();
};

const formatBlockCountLabel = (count: number) => {
  const normalizedCount = Math.abs(Math.trunc(count));
  const mod10 = normalizedCount % 10;
  const mod100 = normalizedCount % 100;

  if (mod100 >= 11 && mod100 <= 14) {
    return `${count} блоков`;
  }

  if (mod10 === 1) {
    return `${count} блок`;
  }

  if (mod10 >= 2 && mod10 <= 4) {
    return `${count} блока`;
  }

  return `${count} блоков`;
};

const clampCalculationParameterValue = (
  key: 'basePrice' | 'discount' | 'minPrice' | 'globalCoefficient',
  value: number,
) => {
  const safeValue = Number.isFinite(value) ? value : 0;

  if (key === 'discount') {
    return Math.min(MAX_CALCULATION_DISCOUNT, Math.max(0, safeValue));
  }

  if (key === 'globalCoefficient') {
    return Math.min(MAX_CALCULATION_COEFFICIENT, Math.max(0, safeValue));
  }

  return Math.min(MAX_CALCULATION_PRICE, Math.max(0, safeValue));
};

const clampFieldMarginValue = (value: number) => {
  const safeValue = Number.isFinite(value) ? value : 0;
  return Math.min(MAX_FIELD_MARGIN, Math.max(0, safeValue));
};

const getCalculationParameterHint = (
  key: 'basePrice' | 'discount' | 'minPrice' | 'globalCoefficient',
) => {
  if (key === 'discount') {
    return `От 0 до ${MAX_CALCULATION_DISCOUNT}%`;
  }

  if (key === 'globalCoefficient') {
    return `От 0 до ${MAX_CALCULATION_COEFFICIENT}`;
  }

  return `От 0 до ${MAX_CALCULATION_PRICE.toLocaleString('ru-RU')}`;
};

const getCalculationParameterCorrectionMessage = (
  key: 'basePrice' | 'discount' | 'minPrice' | 'globalCoefficient',
  nextValue: number,
) => `${getCalculationParameterHint(key)}. Значение скорректировано до ${String(nextValue)}.`;

const sanitizeCalculationParameterInput = (rawValue: string) => {
  const normalizedValue = rawValue.replace(',', '.');
  let hasDecimalSeparator = false;

  return normalizedValue
    .split('')
    .filter((char) => {
      if (/\d/.test(char)) {
        return true;
      }

      if (char === '.' && !hasDecimalSeparator) {
        hasDecimalSeparator = true;
        return true;
      }

      return false;
    })
    .join('')
    .slice(0, MAX_CALCULATION_FIELD_LENGTH);
};

const sanitizeFieldPatch = (
  patch: Partial<CalculatorField>,
  sourceField?: CalculatorField,
): Partial<CalculatorField> => {
  const nextPatch = { ...patch };

  if (typeof nextPatch.label === 'string') {
    nextPatch.label = clampTextValue(nextPatch.label, MAX_FIELD_LABEL_LENGTH);
  }

  if (typeof nextPatch.description === 'string') {
    nextPatch.description = clampTextValue(nextPatch.description, MAX_FIELD_DESCRIPTION_LENGTH);
  }

  if (typeof nextPatch.placeholder === 'string') {
    nextPatch.placeholder = clampTextValue(nextPatch.placeholder, MAX_FIELD_PLACEHOLDER_LENGTH);
  }

  if (typeof nextPatch.hint === 'string') {
    nextPatch.hint = clampTextValue(nextPatch.hint, MAX_FIELD_HINT_LENGTH);
  }

  if (typeof nextPatch.checkboxLabel === 'string') {
    nextPatch.checkboxLabel = clampTextValue(nextPatch.checkboxLabel, MAX_CHECKBOX_LABEL_LENGTH);
  }

  if (typeof nextPatch.textColor === 'string') {
    const fallbackColor =
      sourceField?.textStyle != null
        ? getTextStyleDefaults(sourceField.textStyle).textColor
        : '#6f5d4e';
    nextPatch.textColor = normalizeHexColor(nextPatch.textColor, fallbackColor);
  }

  if (typeof nextPatch.marginTop === 'number') {
    nextPatch.marginTop = clampFieldMarginValue(nextPatch.marginTop);
  }

  if (typeof nextPatch.marginBottom === 'number') {
    nextPatch.marginBottom = clampFieldMarginValue(nextPatch.marginBottom);
  }

  if (typeof nextPatch.marginLeft === 'number') {
    nextPatch.marginLeft = clampFieldMarginValue(nextPatch.marginLeft);
  }

  if (typeof nextPatch.marginRight === 'number') {
    nextPatch.marginRight = clampFieldMarginValue(nextPatch.marginRight);
  }

  return nextPatch;
};

const sanitizeOptionPatch = (
  patch: Partial<CalculatorFieldOption>,
): Partial<CalculatorFieldOption> => {
  const nextPatch = { ...patch };

  if (typeof nextPatch.label === 'string') {
    nextPatch.label = clampTextValue(nextPatch.label, MAX_OPTION_LABEL_LENGTH);
  }

  if (typeof nextPatch.description === 'string') {
    nextPatch.description = clampTextValue(nextPatch.description, MAX_OPTION_DESCRIPTION_LENGTH);
  }

  return nextPatch;
};

const sanitizeTemplatePatch = (
  patch: Partial<CalculatorTemplate>,
): Partial<CalculatorTemplate> => {
  const nextPatch = { ...patch };

  if (typeof nextPatch.resultCardTitle === 'string') {
    nextPatch.resultCardTitle = clampTextValue(
      nextPatch.resultCardTitle,
      MAX_RESULT_CARD_TITLE_LENGTH,
    );
  }

  if (typeof nextPatch.resultSubtotalLabel === 'string') {
    nextPatch.resultSubtotalLabel = clampTextValue(
      nextPatch.resultSubtotalLabel,
      MAX_RESULT_CARD_LABEL_LENGTH,
    );
  }

  if (typeof nextPatch.resultDiscountLabel === 'string') {
    nextPatch.resultDiscountLabel = clampTextValue(
      nextPatch.resultDiscountLabel,
      MAX_RESULT_CARD_LABEL_LENGTH,
    );
  }

  if (typeof nextPatch.resultMinPriceLabel === 'string') {
    nextPatch.resultMinPriceLabel = clampTextValue(
      nextPatch.resultMinPriceLabel,
      MAX_RESULT_CARD_LABEL_LENGTH,
    );
  }

  if (nextPatch.requestForm) {
    nextPatch.requestForm = {
      ...nextPatch.requestForm,
      title: clampTextValue(nextPatch.requestForm.title, MAX_REQUEST_FORM_TITLE_LENGTH),
      description: clampTextValue(
        nextPatch.requestForm.description,
        MAX_REQUEST_FORM_DESCRIPTION_LENGTH,
      ),
      nameLabel: clampTextValue(nextPatch.requestForm.nameLabel, MAX_REQUEST_FORM_LABEL_LENGTH),
      namePlaceholder: clampTextValue(
        nextPatch.requestForm.namePlaceholder,
        MAX_REQUEST_FORM_PLACEHOLDER_LENGTH,
      ),
      phoneLabel: clampTextValue(nextPatch.requestForm.phoneLabel, MAX_REQUEST_FORM_LABEL_LENGTH),
      phonePlaceholder: clampTextValue(
        nextPatch.requestForm.phonePlaceholder,
        MAX_REQUEST_FORM_PLACEHOLDER_LENGTH,
      ),
      commentLabel: clampTextValue(
        nextPatch.requestForm.commentLabel,
        MAX_REQUEST_FORM_LABEL_LENGTH,
      ),
      commentPlaceholder: clampTextValue(
        nextPatch.requestForm.commentPlaceholder,
        MAX_REQUEST_FORM_PLACEHOLDER_LENGTH,
      ),
      submitButtonText: clampTextValue(
        nextPatch.requestForm.submitButtonText,
        MAX_BUTTON_TEXT_LENGTH,
      ),
    };
  }

  return nextPatch;
};

const copyTextToClipboard = async (value: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.width = '1px';
  textarea.style.height = '1px';
  textarea.style.padding = '0';
  textarea.style.border = '0';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  const isCopied = document.execCommand('copy');
  document.body.removeChild(textarea);

  if (!isCopied) {
    throw new Error('Copy command is unavailable');
  }
};

type PreviewDevice = keyof typeof PREVIEW_DEVICE_CONFIG;

type BuilderLibraryItem = {
  id: string;
  label: string;
  icon: React.ComponentType;
  accent: string;
  supported: boolean;
  createField?: () => CalculatorField;
  onAdd?: (
    template: CalculatorTemplate,
    updateTemplate: (patch: Partial<CalculatorTemplate>) => void,
  ) => void;
};

const LocalizedBuilderDateTimeInput = ({
  type,
  value,
  placeholder,
  onChange,
}: LocalizedBuilderDateTimeInputProps) => {
  const [draftValue, setDraftValue] = useState(value);
  const formatDateValue = (rawValue: string) => {
    const digits = rawValue.replace(/\D/g, '').slice(0, 8);

    if (digits.length <= 2) {
      return digits;
    }

    if (digits.length <= 4) {
      return `${digits.slice(0, 2)}.${digits.slice(2)}`;
    }

    return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
  };

  const parseDisplayDateToIso = (rawValue: string) => {
    const match = rawValue.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!match) {
      return '';
    }

    const [, day, month, year] = match;
    return `${year}-${month}-${day}`;
  };

  const formatTimeValue = (rawValue: string) => {
    const digits = rawValue.replace(/\D/g, '').slice(0, 4);

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

  useEffect(() => {
    if (type === 'date') {
      const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      setDraftValue(match ? `${match[3]}.${match[2]}.${match[1]}` : '');
      return;
    }

    setDraftValue(value);
  }, [type, value]);

  return (
    <input
      type="text"
      inputMode={type === 'time' ? 'numeric' : undefined}
      placeholder={placeholder}
      value={draftValue}
      onChange={(event) => {
        const nextValue =
          type === 'time'
            ? formatTimeValue(event.target.value)
            : formatDateValue(event.target.value);
        setDraftValue(nextValue);
        onChange(type === 'time' ? nextValue : parseDisplayDateToIso(nextValue));
      }}
    />
  );
};

const createField = (
  type: FieldType,
  label: string,
  key: string,
  partial?: Partial<CalculatorField>,
): CalculatorField => ({
  id: createRandomId(),
  key: `${key}_${Math.random().toString(36).slice(2, 7)}`,
  label,
  type,
  layout: 'full',
  marginTop: 0,
  marginBottom: 0,
  marginLeft: 0,
  marginRight: 0,
  required: false,
  unitPrice: 0,
  coefficient: 1,
  description: '',
  hidden: false,
  visibilityCondition: '',
  placeholder:
    type === 'number' ||
    type === 'slider' ||
    (type === 'input' && partial?.inputSubtype === 'number')
      ? '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0447\u0438\u0441\u043b\u043e'
      : '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0442\u0435\u043a\u0441\u0442',
  options: partial?.options ?? [],
  showOptionPrices: false,
  optionLayout: 'vertical',
  ...partial,
});

const createUniqueFieldKey = (fields: CalculatorField[], baseKey: string) => {
  const normalizedBaseKey = (baseKey || 'field')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'field';

  let nextKey = `${normalizedBaseKey}_${Math.random().toString(36).slice(2, 7)}`;
  while (fields.some((field) => field.key === nextKey)) {
    nextKey = `${normalizedBaseKey}_${Math.random().toString(36).slice(2, 7)}`;
  }

  return nextKey;
};

const createInputField = (
  inputSubtype: InputFieldSubtype,
  label: string,
  key: string,
  partial?: Partial<CalculatorField>,
) =>
  createField('input', label, key, {
    inputSubtype,
    useValueInFormula: inputSubtype === 'number',
    ...partial,
  });

const duplicateFieldConfig = (field: CalculatorField): CalculatorField => ({
  ...field,
  id: createRandomId(),
  key: `${field.key}_${Math.random().toString(36).slice(2, 6)}`,
  label: field.label ? `${field.label} копия` : 'Копия',
  options: field.options?.map((option) => ({
    ...option,
    id: createRandomId(),
  })),
});

const getInputSubtype = (field: CalculatorField): InputFieldSubtype | null => {
  if (field.type === 'input') {
    return field.inputSubtype ?? 'text';
  }

  if (field.type === 'number') {
    return 'number';
  }

  if (field.type === 'text' && !field.textStyle) {
    return 'text';
  }

  return null;
};

const isInputField = (field: CalculatorField) => getInputSubtype(field) !== null;
const isNumericFormulaField = (field: CalculatorField) =>
  field.type === 'number' ||
  field.type === 'slider' ||
  (field.type === 'input' && field.inputSubtype === 'number');
const isFormulaEligibleField = (field: CalculatorField) =>
  (isNumericFormulaField(field) ||
    field.type === 'checkbox' ||
    field.type === 'select' ||
    field.type === 'radio' ||
    field.type === 'booking') &&
  field.useValueInFormula !== false;

const clampTextFontSize = (value: number) => Math.min(72, Math.max(10, value));
const clampTextFontWeight = (value: number) => Math.min(800, Math.max(300, value));
const toFontWeightControlValue = (value?: number) => Math.round((value ?? 500) / 10);
const fromFontWeightControlValue = (value: number) => clampTextFontWeight(value * 10);

const getInputSubtypeLabel = (inputSubtype: InputFieldSubtype) => {
  switch (inputSubtype) {
    case 'text':
      return 'Текст';
    case 'number':
      return 'Число';
    case 'phone':
      return 'Телефон';
    case 'email':
      return 'Эл. почта';
    case 'date':
      return 'Дата';
    case 'time':
      return 'Время';
    case 'textarea':
      return 'Большой текст';
    case 'file':
      return 'Файл';
    default:
      return 'Поле';
  }
};

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

const getButtonActionLabel = (action?: ButtonActionType) => {
  switch (action) {
    case 'calculate':
      return 'Рассчитать';
    case 'submit':
      return 'Отправить заявку';
    case 'reset':
      return 'Сбросить форму';
    case 'link':
      return 'Перейти по ссылке';
    case 'vk':
      return 'Открыть сообщение в VK';
    case 'copy':
      return 'Скопировать результат';
    default:
      return 'Рассчитать';
  }
};

const createSelectOptions = (): CalculatorFieldOption[] => [
  {
    id: createRandomId(),
    label: '1',
    value: 1500,
    description: '\u0411\u0430\u0437\u043e\u0432\u044b\u0439 \u0432\u0430\u0440\u0438\u0430\u043d\u0442',
  },
  {
    id: createRandomId(),
    label: '2',
    value: 3000,
    description: '\u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043d\u043d\u044b\u0439 \u0432\u0430\u0440\u0438\u0430\u043d\u0442',
  },
];

const createRadioOptions = (): CalculatorFieldOption[] => [
  {
    id: createRandomId(),
    label: '\u0412\u0430\u0440\u0438\u0430\u043d\u0442 1',
    value: 1500,
    description: '\u041a\u043e\u0440\u043e\u0442\u043a\u0430\u044f \u043f\u043e\u0434\u0441\u043a\u0430\u0437\u043a\u0430',
  },
  {
    id: createRandomId(),
    label: '\u0412\u0430\u0440\u0438\u0430\u043d\u0442 2',
    value: 3000,
    description: '\u0415\u0449\u0435 \u043e\u0434\u0438\u043d \u0432\u0430\u0440\u0438\u0430\u043d\u0442',
  },
];
const libraryItems: BuilderLibraryItem[] = [
  {
    id: 'list',
    label: '\u0421\u043f\u0438\u0441\u043e\u043a',
    icon: Icon20ListPlusOutline,
    accent: 'builder-library__icon_amber',
    supported: true,
    createField: () =>
      createField('select', '\u041d\u043e\u0432\u044b\u0439 \u0441\u043f\u0438\u0441\u043e\u043a', 'select', {
        placeholder: '\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0435',
        showOptionPrices: true,
        useValueInFormula: true,
        options: createSelectOptions(),
        defaultValue: 1000,
      }),
  },
  {
    id: 'range',
    label: '\u041f\u043e\u043b\u0437\u0443\u043d\u043e\u043a',
    icon: Icon20SlidersOutline,
    accent: 'builder-library__icon_mint',
    supported: true,
    createField: () =>
      createField('slider', '\u041f\u043e\u043b\u0437\u0443\u043d\u043e\u043a', 'range', {
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 50,
        unit: '\u0448\u0442',
        showCurrentValue: true,
        showScale: true,
        hideScaleNumbers: false,
        allowManualInput: true,
      }),
  },
  {
    id: 'check',
    label: '\u0413\u0430\u043b\u043e\u0447\u043a\u0430',
    icon: Icon20CheckSquareOutline,
    accent: 'builder-library__icon_green',
    supported: true,
    createField: () =>
      createField('checkbox', '\u0414\u043e\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u043d\u0430\u044f \u043e\u043f\u0446\u0438\u044f', 'check', {
        checkboxLabel: '\u0412\u043a\u043b\u044e\u0447\u0438\u0442\u044c \u043e\u043f\u0446\u0438\u044e',
        onValue: 500,
        offValue: 0,
        defaultValue: false,
        showPriceInline: true,
      }),
  },
  {
    id: 'flag',
    label: '\u0424\u043b\u0430\u0436\u043e\u043a',
    icon: Icon20CheckBoxOff,
    accent: 'builder-library__icon_pink',
    supported: true,
    createField: () =>
      createField('checkbox', '\u0424\u043b\u0430\u0436\u043e\u043a', 'flag', {
        checkboxLabel: '\u0410\u043a\u0442\u0438\u0432\u0438\u0440\u043e\u0432\u0430\u0442\u044c',
        onValue: 300,
        offValue: 0,
        defaultValue: false,
        showPriceInline: true,
      }),
  },
  {
    id: 'field',
    label: '\u041f\u043e\u043b\u0435',
    icon: Icon20SquareSplit4Outline,
    accent: 'builder-library__icon_orange',
    supported: true,
    createField: () =>
      createInputField('text', '\u041f\u043e\u043b\u0435', 'input', {
        hint: '\u041f\u043e\u043b\u0435 \u0434\u043b\u044f \u0432\u0432\u043e\u0434\u0430 \u0434\u0430\u043d\u043d\u044b\u0445',
      }),
  },
  {
    id: 'text',
    label: '\u0422\u0435\u043a\u0441\u0442',
    icon: Icon20TextTtOutline,
    accent: 'builder-library__icon_blue',
    supported: true,
    createField: () => {
      const defaults = getTextStyleDefaults('description');
      return createField('text', '\u0422\u0435\u043a\u0441\u0442', 'text', {
        content: '\u041d\u043e\u0432\u044b\u0439 \u0442\u0435\u043a\u0441\u0442',
        textStyle: 'description',
        fontSize: defaults.fontSize,
        fontWeight: defaults.fontWeight,
        textColor: defaults.textColor,
        textAlign: 'left',
      });
    },
  },
  {
    id: 'image',
    label: '\u041a\u0430\u0440\u0442\u0438\u043d\u043a\u0430',
    icon: Icon20PictureOnSquareOutline,
    accent: 'builder-library__icon_teal',
    supported: true,
    createField: () =>
      createField('image', '\u041a\u0430\u0440\u0442\u0438\u043d\u043a\u0430', 'image', {
        imageAlt: '\u0418\u043b\u043b\u044e\u0441\u0442\u0440\u0430\u0446\u0438\u044f',
        imageCaption: '',
        imageSize: 'large',
        imageRadius: 24,
        imageAlign: 'center',
        imageFit: 'cover',
      }),
  },
  {
    id: 'button',
    label: '\u041a\u043d\u043e\u043f\u043a\u0430',
    icon: Icon20AddSquareOutline,
    accent: 'builder-library__icon_violet',
    supported: true,
    createField: () =>
      createField('button', '\u041a\u043d\u043e\u043f\u043a\u0430', 'button', {
        buttonText: '\u0420\u0430\u0441\u0441\u0447\u0438\u0442\u0430\u0442\u044c',
        buttonAction: 'calculate',
        buttonColor: 'accent',
        buttonSize: 'medium',
        buttonWidth: 'auto',
        buttonRadius: 18,
        buttonLoading: false,
        buttonShowWhenValid: false,
        buttonUrl: '',
      }),
  },
  {
    id: 'booking',
    label: '\u0411\u0440\u043e\u043d\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435',
    icon: Icon20CalendarCheckOutline,
    accent: 'builder-library__icon_amber',
    supported: true,
    createField: () =>
      createField('booking', '\u0411\u0440\u043e\u043d\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435', 'booking', {
        placeholder: '\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0434\u0430\u0442\u0443 \u0438 \u0432\u0440\u0435\u043c\u044f',
        hint: '\u0414\u043e\u0441\u0442\u0443\u043f\u043d\u044b\u0435 \u0441\u043b\u043e\u0442\u044b \u043f\u043e\u043a\u0430\u0436\u0443\u0442\u0441\u044f \u043f\u043e\u0441\u043b\u0435 \u0432\u044b\u0431\u043e\u0440\u0430 \u0434\u043d\u044f',
        bookingWeekdays: [1, 2, 3, 4, 5],
        bookingStartTime: '09:00',
        bookingEndTime: '18:00',
        bookingCustomSlots: [],
        bookingSlotDuration: 60,
        bookingSlotBreak: 0,
        bookingExcludedDates: [],
        bookingMaxRequestsPerSlot: 1,
        bookingUrgentSurcharge: 0,
        bookingUrgentThresholdHours: 24,
      }),
  },
  {
    id: 'result',
    label: '\u0420\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442',
    icon: Icon20DocumentStatsOutline,
    accent: 'builder-library__icon_orange',
    supported: true,
    createField: () =>
      createField('result', '\u0420\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442', 'result', {
        resultFormula: 'basePrice',
        resultPrefix: '',
        resultSuffix: ' ₽',
        resultRounding: true,
        resultDecimals: 0,
        resultFormat: 'space',
        resultDisplayMode: 'auto',
        resultVisibilityCondition: '',
      }),
  },
  {
    id: 'html',
    label: '\u0420\u0430\u0437\u043c\u0435\u0442\u043a\u0430',
    icon: Icon20BracketsSlashOutline,
    accent: 'builder-library__icon_amber',
    supported: true,
    createField: () =>
      createField('html', '\u0420\u0430\u0437\u043c\u0435\u0442\u043a\u0430', 'html', {
        htmlContent: '<p>Новый HTML-блок</p>',
      }),
  },
];

const fieldTypeLabels: Record<FieldType, string> = {
  input: '\u041f\u043e\u043b\u0435',
  radio: '\u0424\u043b\u0430\u0436\u043e\u043a',
  number: '\u0427\u0438\u0441\u043b\u043e',
  select: '\u0421\u043f\u0438\u0441\u043e\u043a',
  checkbox: '\u0427\u0435\u043a\u0431\u043e\u043a\u0441',
  result: '\u0420\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442',
  html: '\u0420\u0430\u0437\u043c\u0435\u0442\u043a\u0430',
  text: '\u0422\u0435\u043a\u0441\u0442',
  slider: '\u041f\u043e\u043b\u0437\u0443\u043d\u043e\u043a',
  image: '\u041a\u0430\u0440\u0442\u0438\u043d\u043a\u0430',
  button: '\u041a\u043d\u043e\u043f\u043a\u0430',
  booking: '\u0411\u0440\u043e\u043d\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435',
};

const getPreviewFieldValue = (field: CalculatorField) => {
  if (field.defaultValue !== undefined) {
    return field.defaultValue;
  }

  if (field.type === 'slider') {
    return field.min ?? 0;
  }

  if (field.type === 'input' && field.inputSubtype === 'file') {
    return [];
  }

  if (field.type === 'button') {
    return '';
  }

  if (field.type === 'html') {
    return '';
  }

  if (field.type === 'result') {
    return '';
  }

  if (field.type === 'booking') {
    return '';
  }

  if (field.type === 'checkbox') {
    return (field.options?.length ?? 0) > 0
      ? field.defaultValue === true
        ? ['__primary__']
        : []
      : false;
  }

  return '';
};

const validatePreviewFieldValue = (field: CalculatorField, value: CalculatorValues[string]) => {
  if (field.type === 'button' || field.type === 'result') {
    return '';
  }

  if (field.required) {
    const isEmpty =
      field.type === 'checkbox'
        ? false
        : Array.isArray(value)
          ? value.length === 0
          : value === '' || value === undefined || value === null;

    if (isEmpty) {
      return 'Поле обязательно для заполнения';
    }
  }

  if (field.type === 'booking') {
    return value ? '' : field.required ? 'Выберите дату и время записи' : '';
  }

  if (field.type === 'slider' || field.type === 'number' || (field.type === 'input' && field.inputSubtype === 'number')) {
    if (value === '' || value === undefined || value === null) {
      return '';
    }

    const numericValue = Number(value);
    if (Number.isNaN(numericValue)) {
      return 'Введите корректное число';
    }

    if (field.min !== undefined && numericValue < field.min) {
      return `Минимум: ${field.min}`;
    }

    if (field.max !== undefined && numericValue > field.max) {
      return `Максимум: ${field.max}`;
    }
  }

  return '';
};

const getCheckboxPriceLabel = (field: CalculatorField) => {
  const numericValue =
    typeof field.onValue === 'number' ? field.onValue : Number(field.onValue ?? 0);

  return Number.isFinite(numericValue) ? String(numericValue) + ' \u20bd' : 'true / false';
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const createFormulaTokenPattern = (token: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(token)}(?![\\p{L}\\p{N}_])`, 'giu');

const formatFormulaSubstitutionValue = (value: number) => {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return formatResultNumber(value, 2, 'plain').replace(/\.?0+$/, '');
};

const buildFormulaSubstitution = (
  expression: string,
  fields: CalculatorField[],
  context: Record<string, number>,
  result: number,
) => {
  const trimmedExpression = expression.trim();
  if (!trimmedExpression) {
    return '';
  }

  let substitutedExpression = trimmedExpression
    .replace(createFormulaTokenPattern('basePrice'), formatFormulaSubstitutionValue(context.basePrice ?? 0))
    .replace(
      createFormulaTokenPattern('globalCoefficient'),
      formatFormulaSubstitutionValue(context.globalCoefficient ?? 0),
    )
    .replace(createFormulaTokenPattern('\u0411\u0430\u0437\u043e\u0432\u0430\u044f \u0446\u0435\u043d\u0430'), formatFormulaSubstitutionValue(context.basePrice ?? 0))
    .replace(
      createFormulaTokenPattern('\u041e\u0431\u0449\u0438\u0439 \u043a\u043e\u044d\u0444\u0444\u0438\u0446\u0438\u0435\u043d\u0442'),
      formatFormulaSubstitutionValue(context.globalCoefficient ?? 0),
    );

  const sortedFields = [...fields].sort((left, right) => right.label.length - left.label.length);
  sortedFields.forEach((field, index) => {
    const trimmedLabel = field.label.trim();
    const fieldValue = context[`field_${index + 1}`] ?? context[field.key] ?? 0;

    if (trimmedLabel) {
      substitutedExpression = substitutedExpression.replace(
        createFormulaTokenPattern(trimmedLabel),
        formatFormulaSubstitutionValue(fieldValue),
      );
    }

    substitutedExpression = substitutedExpression.replace(
      createFormulaTokenPattern(field.key),
      formatFormulaSubstitutionValue(fieldValue),
    );
  });

  substitutedExpression = substitutedExpression.replace(/\s+/g, ' ').trim();
  return `${substitutedExpression} = ${formatFormulaSubstitutionValue(result)}`;
};

const getFormulaReference = (field: CalculatorField) => field.label.trim() || '\u0411\u0435\u0437 \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u044f';
const formulaOperatorChips = ['+', '-', '*', '/', '(', ')'] as const;
const formulaComparatorChips = ['>', '<', '>=', '<=', '==', '!='] as const;
const formulaFunctionChips = [
  { value: 'ifElse', label: 'Если' },
  { value: 'min', label: 'Мин' },
  { value: 'max', label: 'Макс' },
  { value: 'round', label: 'Округл' },
  { value: 'abs', label: 'Модуль' },
] as const;
const formulaVariableTokens = [
  { value: 'basePrice', label: 'Базовая цена' },
  { value: 'globalCoefficient', label: 'Общий коэффициент' },
] as const;
const visualFormulaExamples = [
  {
    title: 'Фиксированная цена по условию',
    formula: 'Если(Ползунок > 20, 1000, 0)',
    description: 'Если значение ползунка больше 20, вернётся 1000, иначе 0.',
  },
  {
    title: 'Обычный расчёт',
    formula: 'Ползунок * Базовая цена',
    description: 'Подходит для простого умножения количества на стоимость.',
  },
  {
    title: 'Цена с доплатой',
    formula: 'Ползунок * Базовая цена + 500',
    description: 'К итоговому расчёту добавляется фиксированная сумма.',
  },
  {
    title: 'Минимальный порог',
    formula: 'Макс(Ползунок * Базовая цена, 3000)',
    description: 'Если расчёт меньше 3000, будет показано 3000.',
  },
] as const;

const createVisualFormulaToken = (
  type: VisualFormulaTokenType,
  value: string,
  label = value,
): VisualFormulaToken => ({
  id: createRandomId(),
  type,
  value,
  label,
});

const buildVisualFormulaSequence = (tokens: VisualFormulaToken[]) =>
  tokens
    .map((token, index) => {
      const prev = tokens[index - 1];
      const next = tokens[index + 1];

      if (token.type === 'function') {
        return `${token.value}(`;
      }

      if (token.type === 'comma') {
        return ', ';
      }

      if (token.type === 'paren') {
        if (token.value === '(') {
          return prev && prev.type === 'function' ? '' : '(';
        }

        return ')';
      }

      if (token.type === 'operator' || token.type === 'comparator') {
        return ` ${token.value} `;
      }

      const rawValue = token.value;
      const needsTrailingSpace =
        next &&
        next.type !== 'operator' &&
        next.type !== 'comparator' &&
        next.type !== 'comma' &&
        !(next.type === 'paren' && next.value === ')');

      return `${rawValue}${needsTrailingSpace ? ' ' : ''}`;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();

const buildVisualFormulaString = (tokens: VisualFormulaToken[]) => {
  let equalityTokenIndex = -1;
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (token.type === 'comparator' && token.value === '==') {
      equalityTokenIndex = index;
      break;
    }
  }
  const hasConditionComparatorBeforeEquality = tokens
    .slice(0, equalityTokenIndex)
    .some(
      (token) =>
        token.type === 'comparator' &&
        (token.value === '>' || token.value === '<' || token.value === '>=' || token.value === '<=' || token.value === '!='),
    );
  const hasFunctionSyntax = tokens.some((token) => token.type === 'function' || token.type === 'comma');

  if (
    equalityTokenIndex > 0 &&
    equalityTokenIndex < tokens.length - 1 &&
    hasConditionComparatorBeforeEquality &&
    !hasFunctionSyntax
  ) {
    const conditionExpression = buildVisualFormulaSequence(tokens.slice(0, equalityTokenIndex));
    const truthyExpression = buildVisualFormulaSequence(tokens.slice(equalityTokenIndex + 1));

    if (conditionExpression && truthyExpression) {
      return `ifElse(${conditionExpression}, ${truthyExpression}, 0)`;
    }
  }

  return buildVisualFormulaSequence(tokens);
};

const parseVisualFormulaTokens = (
  formula: string,
  fields: CalculatorField[],
): VisualFormulaToken[] => {
  const source = String(formula || '').trim();
  if (!source) {
    return [];
  }

  const fieldEntries = fields
    .map((field) => ({
      label: getFormulaReference(field),
      value: getFormulaReference(field),
      type: 'field' as const,
    }))
    .sort((left, right) => right.label.length - left.label.length);
  const keywordEntries = [
    ...formulaVariableTokens.map((token) => ({
      label: token.label,
      value: token.value,
      type: 'variable' as const,
    })),
    ...formulaFunctionChips.flatMap((token) => [
      { label: token.label, value: token.value, type: 'function' as const },
      { label: token.value, value: token.value, type: 'function' as const },
    ]),
  ].sort((left, right) => right.label.length - left.label.length);
  const entries = [...fieldEntries, ...keywordEntries];
  const nextTokens: VisualFormulaToken[] = [];

  let cursor = 0;
  while (cursor < source.length) {
    const char = source[cursor];

    if (/\s/.test(char)) {
      cursor += 1;
      continue;
    }

    const matchedEntry = entries.find((entry) => source.startsWith(entry.label, cursor));
    if (matchedEntry) {
      nextTokens.push(createVisualFormulaToken(matchedEntry.type, matchedEntry.value, matchedEntry.label));
      cursor += matchedEntry.label.length;
      continue;
    }

    const comparator = formulaComparatorChips.find((item) => source.startsWith(item, cursor));
    if (comparator) {
      nextTokens.push(createVisualFormulaToken('comparator', comparator, comparator));
      cursor += comparator.length;
      continue;
    }

    if (/[+\-*/]/.test(char)) {
      nextTokens.push(createVisualFormulaToken('operator', char, char));
      cursor += 1;
      continue;
    }

    if (char === '(' || char === ')') {
      nextTokens.push(createVisualFormulaToken('paren', char, char));
      cursor += 1;
      continue;
    }

    if (char === ',') {
      nextTokens.push(createVisualFormulaToken('comma', char, char));
      cursor += 1;
      continue;
    }

    const numberMatch = source.slice(cursor).match(/^\d+(?:[.,]\d+)?/);
    if (numberMatch) {
      nextTokens.push(createVisualFormulaToken('number', numberMatch[0], numberMatch[0]));
      cursor += numberMatch[0].length;
      continue;
    }

    cursor += 1;
  }

  return nextTokens;
};

const getFieldSpacingStyle = (field: CalculatorField) => ({
  marginTop: `${clampFieldMarginValue(field.marginTop ?? 0)}px`,
  marginBottom: `${clampFieldMarginValue(field.marginBottom ?? 0)}px`,
  marginLeft: `${clampFieldMarginValue(field.marginLeft ?? 0)}px`,
  marginRight: `${clampFieldMarginValue(field.marginRight ?? 0)}px`,
});

const formatTestValue = (field: CalculatorField, value: unknown) => {
  if (value === undefined || value === null || value === '') {
    return '—';
  }

  if (field.type === 'checkbox') {
    if (Array.isArray(value)) {
      return value.length > 0 ? 'Выбрано' : 'Не выбрано';
    }

    return value ? 'Да' : 'Нет';
  }

  if (field.type === 'select' || field.type === 'radio') {
    const option = field.options?.find((item) => String(item.value) === String(value));
    return option?.label || String(value);
  }

  if (field.type === 'booking' && typeof value === 'object') {
    return 'Слот выбран';
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? value.map((item) => String(item)).join(', ') : '—';
  }

  return String(value);
};

const normalizeFieldLayouts = (fields: CalculatorField[]) =>
  fields.map((field, index, items) => {
    if (field.layout !== 'half') {
      return { ...field, layout: 'full' as const };
    }

    const prevIsHalf = items[index - 1]?.layout === 'half';
    const nextIsHalf = items[index + 1]?.layout === 'half';

    return {
      ...field,
      layout: prevIsHalf || nextIsHalf ? ('half' as const) : ('full' as const),
    };
  });

const hasMojibake = (value?: string) =>
  typeof value === 'string' &&
  value.length > 0 &&
  (value.includes('Р') ||
    value.includes('Ð') ||
    value.includes('Ñ') ||
    value.includes('вЂ') ||
    value.includes('Â'));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getJsonValueTypeLabel = (value: unknown) => {
  if (Array.isArray(value)) {
    return 'массив';
  }

  if (value === null) {
    return 'null';
  }

  switch (typeof value) {
    case 'string':
      return 'строку';
    case 'number':
      return 'число';
    case 'boolean':
      return 'булево значение';
    case 'object':
      return 'объект';
    default:
      return 'значение';
  }
};

const throwJsonTypeError = (path: string, expected: string, actual: unknown, fieldLabel?: string): never => {
  const fieldSuffix = fieldLabel ? ` для поля "${fieldLabel}"` : '';
  throw new Error(
    `${path}${fieldSuffix} должно содержать ${expected}. Сейчас передан ${getJsonValueTypeLabel(actual)}.`,
  );
};

const assertOptionalString = (
  value: unknown,
  path: string,
  fieldLabel?: string,
): void => {
  if (value !== undefined && typeof value !== 'string') {
    throwJsonTypeError(path, 'строку', value, fieldLabel);
  }
};

const assertOptionalNumber = (
  value: unknown,
  path: string,
  fieldLabel?: string,
): void => {
  if (value !== undefined && typeof value !== 'number') {
    throwJsonTypeError(path, 'число', value, fieldLabel);
  }
};

const assertOptionalBoolean = (
  value: unknown,
  path: string,
  fieldLabel?: string,
): void => {
  if (value !== undefined && typeof value !== 'boolean') {
    throwJsonTypeError(path, 'булево значение', value, fieldLabel);
  }
};

const assertStringArray = (value: unknown, path: string, fieldLabel?: string): void => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(
      `${path}${fieldLabel ? ` для поля "${fieldLabel}"` : ''} должно содержать массив строк.`,
    );
  }
};

const validateFieldDefaultValue = (
  field: Record<string, unknown>,
  path: string,
  fieldLabel?: string,
) => {
  const defaultValue = field.defaultValue;

  if (defaultValue === undefined) {
    return;
  }

  const fieldType = field.type;
  const hasOptions = Array.isArray(field.options) && field.options.length > 0;

  if (fieldType === 'checkbox') {
    if (hasOptions) {
      if (typeof defaultValue === 'boolean') {
        return;
      }

      assertStringArray(defaultValue, path, fieldLabel);
      return;
    }

    assertOptionalBoolean(defaultValue, path, fieldLabel);
    return;
  }

  if (fieldType === 'number' || fieldType === 'slider') {
    assertOptionalNumber(defaultValue, path, fieldLabel);
    return;
  }

  if (fieldType === 'radio' || fieldType === 'select') {
    if (typeof defaultValue !== 'string' && typeof defaultValue !== 'number') {
      throwJsonTypeError(path, 'строку или число', defaultValue, fieldLabel);
    }
    return;
  }

  if (typeof defaultValue !== 'string') {
    throwJsonTypeError(path, 'строку', defaultValue, fieldLabel);
  }
};

function validateImportedTemplate(value: unknown): asserts value is CalculatorTemplate {
  if (!isRecord(value)) {
    throw new Error('Корень JSON должен содержать объект шаблона.');
  }

  if (value.fields !== undefined && !Array.isArray(value.fields)) {
    throw new Error('fields должно содержать массив полей.');
  }

  const requestForm = value.requestForm;
  if (requestForm !== undefined) {
    if (!isRecord(requestForm)) {
      throw new Error('requestForm должно содержать объект настроек формы.');
    }

    assertOptionalString(requestForm.title, 'requestForm.title');
    assertOptionalString(requestForm.description, 'requestForm.description');
    assertOptionalString(requestForm.nameLabel, 'requestForm.nameLabel');
    assertOptionalString(requestForm.namePlaceholder, 'requestForm.namePlaceholder');
    assertOptionalString(requestForm.phoneLabel, 'requestForm.phoneLabel');
    assertOptionalString(requestForm.phonePlaceholder, 'requestForm.phonePlaceholder');
    assertOptionalString(requestForm.commentLabel, 'requestForm.commentLabel');
    assertOptionalString(requestForm.commentPlaceholder, 'requestForm.commentPlaceholder');
    assertOptionalString(requestForm.submitButtonText, 'requestForm.submitButtonText');
    assertOptionalBoolean(requestForm.enabled, 'requestForm.enabled');
  }

  (value.fields ?? []).forEach((field, index) => {
    if (!isRecord(field)) {
      throw new Error(`fields[${index}] должно содержать объект поля.`);
    }

    const fieldLabel = typeof field.label === 'string' && field.label.trim() ? field.label : undefined;
    const fieldPath = `fields[${index}]`;
    const stringProps = [
      'id',
      'key',
      'label',
      'description',
      'placeholder',
      'hint',
      'htmlContent',
      'content',
      'visibilityCondition',
      'checkboxLabel',
      'buttonText',
      'buttonUrl',
      'resultFormula',
      'resultPrefix',
      'resultSuffix',
      'resultVisibilityCondition',
      'imageUrl',
      'imageAlt',
      'imageCaption',
      'bookingStartTime',
      'bookingEndTime',
      'bookingMinDate',
      'bookingMaxDate',
    ] as const;
    const numericProps = [
      'unitPrice',
      'coefficient',
      'min',
      'max',
      'step',
      'minLength',
      'maxLength',
      'fontSize',
      'fontWeight',
      'maxFileSizeMb',
      'resultDecimals',
      'bookingSlotDuration',
      'bookingSlotBreak',
      'bookingMaxRequestsPerSlot',
      'bookingUrgentSurcharge',
      'bookingUrgentThresholdHours',
      'marginTop',
      'marginBottom',
      'marginLeft',
      'marginRight',
      'buttonRadius',
      'imageRadius',
    ] as const;
    const booleanProps = [
      'required',
      'hidden',
      'showPriceInline',
      'showOptionPrices',
      'showOptionDetails',
      'showOptionDescription',
      'showOptionPrice',
      'useValueInFormula',
      'validatePhone',
      'validateEmail',
      'showCurrentValue',
      'showScale',
      'hideScaleNumbers',
      'allowManualInput',
      'resultRounding',
      'buttonShowWhenValid',
    ] as const;

    stringProps.forEach((prop) => assertOptionalString(field[prop], `${fieldPath}.${prop}`, fieldLabel));
    numericProps.forEach((prop) => assertOptionalNumber(field[prop], `${fieldPath}.${prop}`, fieldLabel));
    booleanProps.forEach((prop) => assertOptionalBoolean(field[prop], `${fieldPath}.${prop}`, fieldLabel));

    if (field.onValue !== undefined && typeof field.onValue !== 'string' && typeof field.onValue !== 'number') {
      throwJsonTypeError(`${fieldPath}.onValue`, 'строку или число', field.onValue, fieldLabel);
    }

    if (field.offValue !== undefined && typeof field.offValue !== 'string' && typeof field.offValue !== 'number') {
      throwJsonTypeError(`${fieldPath}.offValue`, 'строку или число', field.offValue, fieldLabel);
    }

    if (field.options !== undefined) {
      if (!Array.isArray(field.options)) {
        throw new Error(`${fieldPath}.options${fieldLabel ? ` для поля "${fieldLabel}"` : ''} должно содержать массив.`);
      }

      field.options.forEach((option, optionIndex) => {
        if (!isRecord(option)) {
          throw new Error(`${fieldPath}.options[${optionIndex}] должно содержать объект варианта.`);
        }

        assertOptionalString(option.id, `${fieldPath}.options[${optionIndex}].id`, fieldLabel);
        assertOptionalString(option.label, `${fieldPath}.options[${optionIndex}].label`, fieldLabel);
        assertOptionalString(
          option.description,
          `${fieldPath}.options[${optionIndex}].description`,
          fieldLabel,
        );
        assertOptionalString(option.image, `${fieldPath}.options[${optionIndex}].image`, fieldLabel);
        if (option.value !== undefined && typeof option.value !== 'string' && typeof option.value !== 'number') {
          throwJsonTypeError(
            `${fieldPath}.options[${optionIndex}].value`,
            'строку или число',
            option.value,
            fieldLabel,
          );
        }
      });
    }

    if (field.bookingWeekdays !== undefined) {
      if (!Array.isArray(field.bookingWeekdays) || field.bookingWeekdays.some((day) => typeof day !== 'number')) {
        throw new Error(`${fieldPath}.bookingWeekdays${fieldLabel ? ` для поля "${fieldLabel}"` : ''} должно содержать массив чисел.`);
      }
    }

    if (field.bookingCustomSlots !== undefined) {
      assertStringArray(field.bookingCustomSlots, `${fieldPath}.bookingCustomSlots`, fieldLabel);
    }

    if (field.bookingExcludedDates !== undefined) {
      assertStringArray(field.bookingExcludedDates, `${fieldPath}.bookingExcludedDates`, fieldLabel);
    }

    validateFieldDefaultValue(field, `${fieldPath}.defaultValue`, fieldLabel);
  });
}

function assertTemplateSystemFieldsUnchanged(
  importedTemplate: CalculatorTemplate,
  currentTemplate: CalculatorTemplate,
) {
  if (String(importedTemplate.id || '') !== String(currentTemplate.id)) {
    throw new Error('Системное поле id нельзя изменять через JSON-хранилище.');
  }
}

const getCleanFieldLabel = (field: CalculatorField) => {
  const inputSubtype = getInputSubtype(field);

  if (inputSubtype === 'number') {
    return '\u0427\u0438\u0441\u043b\u043e\u0432\u043e\u0435 \u043f\u043e\u043b\u0435';
  }

  if (inputSubtype === 'textarea') {
    return '\u0422\u0435\u043a\u0441\u0442\u043e\u0432\u043e\u0435 \u043f\u043e\u043b\u0435';
  }

  if (inputSubtype) {
    return '\u041f\u043e\u043b\u0435';
  }

  switch (field.type) {
    case 'image':
      return '\u041a\u0430\u0440\u0442\u0438\u043d\u043a\u0430';
    case 'radio':
      return '\u0424\u043b\u0430\u0436\u043e\u043a';
    case 'checkbox':
      return '\u0414\u043e\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u043d\u0430\u044f \u043e\u043f\u0446\u0438\u044f';
    case 'slider':
      return '\u041f\u043e\u043b\u0437\u0443\u043d\u043e\u043a';
    case 'select':
      return '\u041d\u043e\u0432\u044b\u0439 \u0441\u043f\u0438\u0441\u043e\u043a';
    case 'text':
      return '\u0422\u0435\u043a\u0441\u0442';
    default:
      return '\u0427\u0438\u0441\u043b\u043e\u0432\u043e\u0435 \u043f\u043e\u043b\u0435';
  }
};

const getCleanPlaceholder = (field: CalculatorField) => {
  const inputSubtype = getInputSubtype(field);

  if (inputSubtype === 'number') {
    return '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0447\u0438\u0441\u043b\u043e';
  }

  if (inputSubtype) {
    return '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0442\u0435\u043a\u0441\u0442';
  }

  switch (field.type) {
    case 'image':
      return '';
    case 'radio':
      return '\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043e\u0434\u0438\u043d \u0432\u0430\u0440\u0438\u0430\u043d\u0442';
    case 'select':
      return '\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0435';
    case 'slider':
    case 'number':
      return '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0447\u0438\u0441\u043b\u043e';
    default:
      return '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0442\u0435\u043a\u0441\u0442';
  }
};

const normalizeFieldContent = (field: CalculatorField): CalculatorField => {
  const showRadioOptionDetails = Boolean(field.showOptionDetails);
  const inputSubtype = getInputSubtype(field);
  const normalizedOptions = field.options?.map((option, index) => ({
    ...option,
    label: hasMojibake(option.label) ? `\u0412\u0430\u0440\u0438\u0430\u043d\u0442 ${index + 1}` : option.label,
    description: hasMojibake(option.description)
      ? field.type === 'radio'
        ? index === 0
          ? '\u041a\u043e\u0440\u043e\u0442\u043a\u0430\u044f \u043f\u043e\u0434\u0441\u043a\u0430\u0437\u043a\u0430'
          : '\u0415\u0449\u0435 \u043e\u0434\u0438\u043d \u0432\u0430\u0440\u0438\u0430\u043d\u0442'
        : index === 0
          ? '\u0411\u0430\u0437\u043e\u0432\u044b\u0439 \u0432\u0430\u0440\u0438\u0430\u043d\u0442'
          : '\u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043d\u043d\u044b\u0439 \u0432\u0430\u0440\u0438\u0430\u043d\u0442'
      : option.description,
  }));

  return {
    ...field,
    type:
      field.type === 'number' || (field.type === 'text' && !field.textStyle) ? 'input' : field.type,
    inputSubtype:
      field.type === 'number'
        ? 'number'
        : field.type === 'text' && !field.textStyle
          ? 'text'
          : field.inputSubtype ?? inputSubtype ?? undefined,
    label: hasMojibake(field.label) ? getCleanFieldLabel(field) : field.label,
    description: hasMojibake(field.description) ? '' : field.description,
    placeholder: hasMojibake(field.placeholder) ? getCleanPlaceholder(field) : field.placeholder,
    checkboxLabel: hasMojibake(field.checkboxLabel)
      ? '\u0412\u043a\u043b\u044e\u0447\u0438\u0442\u044c \u043e\u043f\u0446\u0438\u044e'
      : field.checkboxLabel,
    showOptionDescription:
      field.showOptionDescription ?? (field.type === 'radio' ? showRadioOptionDetails : undefined),
    showOptionPrice:
      field.showOptionPrice ?? (field.type === 'radio' ? showRadioOptionDetails : undefined),
    htmlContent: field.type === 'html' ? sanitizeHtml(field.htmlContent ?? '') : field.htmlContent,
    options: normalizedOptions,
    buttonText:
      field.type === 'button' && hasMojibake(field.buttonText)
        ? getButtonActionLabel(field.buttonAction)
        : field.buttonText,
  };
};

const normalizeRequestFormContent = (
  template: CalculatorTemplate,
): CalculatorTemplate['requestForm'] => {
  const defaults = createDefaultRequestFormSettings();
  const requestForm = template.requestForm ?? defaults;

  return {
    ...requestForm,
    title: clampTextValue(
      hasMojibake(requestForm.title) ? defaults.title : requestForm.title,
      MAX_REQUEST_FORM_TITLE_LENGTH,
    ),
    description: hasMojibake(requestForm.description)
      ? clampTextValue(defaults.description, MAX_REQUEST_FORM_DESCRIPTION_LENGTH)
      : clampTextValue(requestForm.description, MAX_REQUEST_FORM_DESCRIPTION_LENGTH),
    nameLabel: clampTextValue(
      hasMojibake(requestForm.nameLabel) ? defaults.nameLabel : requestForm.nameLabel,
      MAX_REQUEST_FORM_LABEL_LENGTH,
    ),
    namePlaceholder: clampTextValue(
      hasMojibake(requestForm.namePlaceholder)
        ? defaults.namePlaceholder
        : requestForm.namePlaceholder,
      MAX_REQUEST_FORM_PLACEHOLDER_LENGTH,
    ),
    phoneLabel: clampTextValue(
      hasMojibake(requestForm.phoneLabel) ? defaults.phoneLabel : requestForm.phoneLabel,
      MAX_REQUEST_FORM_LABEL_LENGTH,
    ),
    phonePlaceholder: clampTextValue(
      hasMojibake(requestForm.phonePlaceholder)
        ? defaults.phonePlaceholder
        : requestForm.phonePlaceholder,
      MAX_REQUEST_FORM_PLACEHOLDER_LENGTH,
    ),
    commentLabel: clampTextValue(
      hasMojibake(requestForm.commentLabel) ? defaults.commentLabel : requestForm.commentLabel,
      MAX_REQUEST_FORM_LABEL_LENGTH,
    ),
    commentPlaceholder: clampTextValue(
      hasMojibake(requestForm.commentPlaceholder)
        ? defaults.commentPlaceholder
        : requestForm.commentPlaceholder,
      MAX_REQUEST_FORM_PLACEHOLDER_LENGTH,
    ),
    submitButtonText: clampTextValue(
      hasMojibake(requestForm.submitButtonText)
        ? defaults.submitButtonText
        : requestForm.submitButtonText,
      MAX_BUTTON_TEXT_LENGTH,
    ),
  };
};

const normalizeTemplateContent = (template: CalculatorTemplate): CalculatorTemplate => {
  const normalizedRecord = normalizeTemplateRecord(template);

  return {
    ...normalizedRecord,
    title: hasMojibake(normalizedRecord.title) ? createEmptyTemplate().title : normalizedRecord.title,
    description: hasMojibake(normalizedRecord.description)
      ? createEmptyTemplate().description
      : normalizedRecord.description,
    requestForm: normalizeRequestFormContent(normalizedRecord),
    fields: normalizeFieldLayouts(normalizedRecord.fields.map(normalizeFieldContent)),
  };
};

export const BuilderPage = ({
  initialTemplate,
  onBack,
  onSave,
  canUseBooking = true,
  canUseProFeatures = true,
  isMonetizationRestricted = false,
}: BuilderPageProps) => {
  const topbarRef = useRef<HTMLElement | null>(null);
  const restrictedFeatureHint = isMonetizationRestricted
    ? 'Эта настройка недоступна на текущей платформе.'
    : '';
  const proFeatureHint = (message: string) =>
    isMonetizationRestricted ? restrictedFeatureHint : message;
  const [template, setTemplate] = useState<CalculatorTemplate>(
    normalizeTemplateContent(initialTemplate ?? createEmptyTemplate()),
  );
  const resultFieldCount = template.fields.filter((field) => field.type === 'result').length;
  const preparedLibraryItems = libraryItems.map((item) =>
    item.id === 'flag'
      ? {
          ...item,
          supported: canUseProFeatures,
          label: canUseProFeatures
            ? item.label
            : isMonetizationRestricted
              ? 'Флажок (Недоступно)'
              : 'Флажок (Про)',
          createField: () =>
            createField('radio', '\u0424\u043b\u0430\u0436\u043e\u043a', 'flag', {
              placeholder: '\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043e\u0434\u0438\u043d \u0432\u0430\u0440\u0438\u0430\u043d\u0442',
              options: createRadioOptions(),
              defaultValue: 1500,
              optionLayout: 'vertical',
              showOptionDescription: true,
              showOptionPrice: true,
              useValueInFormula: true,
            }),
        }
      : item.id === 'result'
        ? {
            ...item,
            supported: canUseProFeatures || resultFieldCount === 0,
            label:
              canUseProFeatures || resultFieldCount === 0
                ? item.label
                : isMonetizationRestricted
                  ? 'Доп. результат (Недоступно)'
                  : 'Доп. результат (Про)',
          }
        : item.id === 'booking'
          ? {
              ...item,
              supported: canUseBooking && canUseProFeatures,
              label:
                canUseBooking && canUseProFeatures
                  ? item.label
                  : isMonetizationRestricted
                    ? 'Бронирование (Недоступно)'
                    : 'Бронирование (Про)',
            }
          : PRO_LIBRARY_ITEM_IDS.has(item.id)
            ? {
                ...item,
                supported: canUseProFeatures,
                label: canUseProFeatures
                  ? item.label
                  : `${item.label} (${isMonetizationRestricted ? 'Недоступно' : 'Про'})`,
              }
            : item,
  );
  const [saveStatus, setSaveStatus] = useState('');
  const [saveToastKey, setSaveToastKey] = useState(0);
  const [floatingToggleTop, setFloatingToggleTop] = useState(100);
  const [isScrollJumpUp, setIsScrollJumpUp] = useState(false);
  const [isScrollJumpVisible, setIsScrollJumpVisible] = useState(false);
  const [isOverlayViewport, setIsOverlayViewport] = useState(false);
  const saveToastTimeoutRef = useRef<number | null>(null);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  const [isTestMode, setIsTestMode] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>('desktop');
  const [isSpacingOpen, setIsSpacingOpen] = useState(false);
  const [mode, setMode] = useState<'design' | 'formula'>('design');
  const [isAutoSaveEnabled, setIsAutoSaveEnabled] = useState(() => {
    try {
      return localStorage.getItem(BUILDER_AUTOSAVE_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(
    initialTemplate?.fields[0]?.id ?? REQUEST_FORM_SELECTION_ID,
  );
  const [draggedFieldId, setDraggedFieldId] = useState<string | null>(null);
  const [dragOverFieldId, setDragOverFieldId] = useState<string | null>(null);
  const [dragOverPlacement, setDragOverPlacement] = useState<'before' | 'after' | 'left' | 'right'>('after');
  const [draggedOptionId, setDraggedOptionId] = useState<string | null>(null);
  const [dragOverOptionId, setDragOverOptionId] = useState<string | null>(null);
  const [pendingDeleteFieldId, setPendingDeleteFieldId] = useState<string | null>(null);
  const [pendingDeleteOption, setPendingDeleteOption] = useState<{
    fieldId: string;
    optionId: string;
    label: string;
  } | null>(null);
  const [isJsonModalOpen, setIsJsonModalOpen] = useState(false);
  const [jsonDraft, setJsonDraft] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [fieldEntranceDelays, setFieldEntranceDelays] = useState<Record<string, number>>({});
  const previousFieldIdsRef = useRef(template.fields.map((field) => field.id));
  const hasTrackedFieldInsertionsRef = useRef(false);
  const staggerTimeoutsRef = useRef<number[]>([]);
  const previousFieldCountRef = useRef(template.fields.length);
  const previousRequestFormEnabledRef = useRef(template.requestForm.enabled);
  const hasHandledInitialCanvasSelectionRef = useRef(false);
  const [activeLegalDoc, setActiveLegalDoc] = useState<LegalDocKey | null>(null);
  const [previewConsentChecked, setPreviewConsentChecked] = useState(false);
  const [previewRequestFormValues, setPreviewRequestFormValues] = useState({
    name: '',
    phone: '',
    comment: '',
  });
  const [previewErrors, setPreviewErrors] = useState<Record<string, string>>({});
  const [previewStatus, setPreviewStatus] = useState('');
  const [isPreviewValidationTriggered, setIsPreviewValidationTriggered] = useState(false);
  const [previewValues, setPreviewValues] = useState<CalculatorValues>(() =>
    normalizeTemplateContent(initialTemplate ?? createEmptyTemplate()).fields.reduce<CalculatorValues>((acc, field) => {
      acc[field.key] = getPreviewFieldValue(field);
      return acc;
    }, {}),
  );

  useEffect(() => {
    const body = document.body;
    const root = document.getElementById('root');
    const previousBodyOverflow = body.style.overflow;
    const previousBodyMinHeight = body.style.minHeight;
    const previousRootHeight = root?.style.height ?? '';
    const previousRootOverflow = root?.style.overflow ?? '';

    body.style.overflow = 'auto';
    body.style.minHeight = '100dvh';

    if (root) {
      root.style.height = 'auto';
      root.style.overflow = 'visible';
    }

    return () => {
      body.style.overflow = previousBodyOverflow;
      body.style.minHeight = previousBodyMinHeight;

      if (root) {
        root.style.height = previousRootHeight;
        root.style.overflow = previousRootOverflow;
      }
    };
  }, []);

  useEffect(() => {
    if (!activeLegalDoc) {
      return;
    }

    const body = document.body;
    const root = document.getElementById('root');
    const previousBodyOverflow = body.style.overflow;
    const previousRootOverflow = root?.style.overflow ?? '';

    body.style.overflow = 'hidden';

    if (root) {
      root.style.overflow = 'hidden';
    }

    return () => {
      body.style.overflow = previousBodyOverflow;

      if (root) {
        root.style.overflow = previousRootOverflow;
      }
    };
  }, [activeLegalDoc]);

  const [formulaDrafts, setFormulaDrafts] = useState(() => ({
    basePrice: String((initialTemplate ?? createEmptyTemplate()).basePrice),
    discount: String((initialTemplate ?? createEmptyTemplate()).discount),
    minPrice: String((initialTemplate ?? createEmptyTemplate()).minPrice),
    globalCoefficient: String((initialTemplate ?? createEmptyTemplate()).globalCoefficient),
  }));
  const [formulaDraftErrors, setFormulaDraftErrors] = useState<
    Record<'basePrice' | 'discount' | 'minPrice' | 'globalCoefficient', string>
  >({
    basePrice: '',
    discount: '',
    minPrice: '',
    globalCoefficient: '',
  });
  const [formulaNumberDraft, setFormulaNumberDraft] = useState('');
  const [isFormulaExamplesOpen, setIsFormulaExamplesOpen] = useState(false);
  const canvasRef = useRef<HTMLElement | null>(null);
  const libraryPanelRef = useRef<HTMLDivElement | null>(null);
  const inspectorPanelRef = useRef<HTMLDivElement | null>(null);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const customFormulaRef = useRef<HTMLTextAreaElement | null>(null);

  const selectedField = useMemo(
    () => template.fields.find((field) => field.id === selectedFieldId) ?? null,
    [selectedFieldId, template.fields],
  );
  const isRequestFormSelected = selectedFieldId === REQUEST_FORM_SELECTION_ID;
  const isResultCardSelected = selectedFieldId === RESULT_CARD_SELECTION_ID;
  const isLivePreview = isPreview || isTestMode;
  const isInspectorVisible = !isLivePreview && isInspectorOpen;
  const visualFormulaTokens = template.visualFormulaTokens ?? [];
  const visualFormulaExpression = useMemo(
    () => buildVisualFormulaString(visualFormulaTokens),
    [visualFormulaTokens],
  );
  const previewResultCardTitle = template.resultCardTitle ?? 'Итог расчета';
  const previewCalculation = useMemo(() => calculateTemplate(template, previewValues), [previewValues, template]);
  const primaryResultField = useMemo(
    () => template.fields.find((field) => field.type === 'result') ?? null,
    [template.fields],
  );
  const formatPreviewMoneyValue = (value: number) => {
    const decimals = Math.min(6, Math.max(0, primaryResultField?.resultDecimals ?? 0));
    const shouldRound = primaryResultField?.resultRounding !== false;
    const normalizedValue = shouldRound ? Number(value.toFixed(decimals)) : value;

    return formatResultNumber(
      normalizedValue,
      shouldRound ? 0 : decimals,
      primaryResultField?.resultFormat ?? 'space',
    );
  };

  useEffect(() => {
    if (!isOverlayViewport || mode === 'formula' || isLivePreview || (!isLibraryOpen && !isInspectorVisible)) {
      return;
    }

    const body = document.body;
    const root = document.getElementById('root');
    const previousBodyOverflow = body.style.overflow;
    const previousRootOverflow = root?.style.overflow ?? '';

    body.style.overflow = 'hidden';

    if (root) {
      root.style.overflow = 'hidden';
    }

    return () => {
      body.style.overflow = previousBodyOverflow;

      if (root) {
        root.style.overflow = previousRootOverflow;
      }
    };
  }, [isInspectorVisible, isLibraryOpen, isLivePreview, isOverlayViewport, mode]);

  const previewFormulaState = useMemo(() => {
    const activeFormulaExpression =
      template.formulaEditorMode === 'visual' ? visualFormulaExpression : template.customFormula;
    if (template.formulaMode !== 'custom' || !activeFormulaExpression.trim()) {
      return { value: previewCalculation.subtotal, error: '' };
    }

    return evaluateFormulaExpression(activeFormulaExpression, template, previewValues);
  }, [
    previewCalculation.subtotal,
    previewValues,
    template,
    visualFormulaExpression,
  ]);
  const previewFormulaContext = useMemo(() => buildFormulaContext(template, previewValues), [previewValues, template]);
  const previewFormulaSubstitution = useMemo(() => {
    const activeFormulaExpression =
      template.formulaEditorMode === 'visual' ? visualFormulaExpression : template.customFormula;

    if (template.formulaMode !== 'custom' || !activeFormulaExpression.trim() || previewFormulaState.error) {
      return '';
    }

    return buildFormulaSubstitution(
      activeFormulaExpression,
      template.fields,
      previewFormulaContext,
      previewFormulaState.value,
    );
  }, [
    previewFormulaContext,
    previewFormulaState.error,
    previewFormulaState.value,
    template.customFormula,
    template.fields,
    template.formulaEditorMode,
    template.formulaMode,
    visualFormulaExpression,
  ]);
  const resultFieldFormulaErrors = useMemo(
    () =>
      template.fields.reduce<Record<string, string>>((acc, field) => {
        if (field.type !== 'result' || !field.resultFormula?.trim()) {
          return acc;
        }

        const evaluation = evaluateFormulaExpression(field.resultFormula, template, previewValues);
        if (evaluation.error) {
          acc[field.id] = evaluation.error;
        }

        return acc;
      }, {}),
    [previewValues, template],
  );
  const previewValueEntries = useMemo(
    () =>
      template.fields
        .filter((field) => !['button', 'html', 'result'].includes(field.type))
        .map((field) => ({
          id: field.id,
          label: field.label || field.key,
          value: formatTestValue(field, previewValues[field.key] ?? getPreviewFieldValue(field)),
        })),
    [previewValues, template.fields],
  );
  const isPreviewFormValid = useMemo(
    () =>
      template.fields.every(
        (field) => !validatePreviewFieldValue(field, previewValues[field.key] ?? getPreviewFieldValue(field)),
      ),
    [previewValues, template.fields],
  );
  const previewResultCardDescription = template.requestForm.enabled
    ? previewStatus ||
      `Подытог: ${formatPreviewMoneyValue(previewCalculation.subtotal)} ₽ · Скидка: ${formatPreviewMoneyValue(previewCalculation.discountAmount)} ₽`
    : 'Результат и кнопка действия будут показаны здесь.';
  const autoSaveTimeoutRef = useRef<number | null>(null);
  const hasMountedRef = useRef(false);

  const validatePreviewFields = (nextValues: CalculatorValues = previewValues) => {
    const nextErrors: Record<string, string> = {};

    template.fields.forEach((field) => {
      const error = validatePreviewFieldValue(field, nextValues[field.key] ?? getPreviewFieldValue(field));
      if (error) {
        nextErrors[field.key] = error;
      }
    });

    setPreviewErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handlePreviewButtonAction = (action: ButtonActionType) => {
    setIsPreviewValidationTriggered(true);

    if (!validatePreviewFields()) {
      setPreviewStatus('Заполните обязательные поля');
      return;
    }

    if (action === 'submit') {
      setPreviewStatus('Все обязательные поля заполнены. Предпросмотр готов к отправке заявки.');
      return;
    }

    setPreviewStatus(`Итог: ${formatPreviewMoneyValue(previewCalculation.total)} ₽`);
  };

  useEffect(() => {
    setPreviewValues((current) =>
      template.fields.reduce<CalculatorValues>((acc, field) => {
        acc[field.key] =
          current[field.key] !== undefined ? current[field.key] : getPreviewFieldValue(field);
        return acc;
      }, {}),
    );
  }, [template.fields]);

  useEffect(() => {
    setPreviewErrors({});
    setPreviewStatus('');
    setIsPreviewValidationTriggered(false);
  }, [template.id]);

  useEffect(() => {
    setFormulaDrafts({
      basePrice: String(template.basePrice),
      discount: String(template.discount),
      minPrice: String(template.minPrice),
      globalCoefficient: String(template.globalCoefficient),
    });
  }, [template.basePrice, template.discount, template.globalCoefficient, template.minPrice]);

  useEffect(() => {
    if (
      template.formulaEditorMode === 'visual' &&
      (template.visualFormulaTokens?.length ?? 0) === 0 &&
      template.customFormula.trim()
    ) {
      const parsedTokens = parseVisualFormulaTokens(template.customFormula, template.fields);
      if (parsedTokens.length > 0) {
        setTemplate((current) => ({
          ...current,
          visualFormulaTokens: parsedTokens,
        }));
      }
    }
  }, [template.customFormula, template.fields, template.formulaEditorMode, template.visualFormulaTokens]);

  useEffect(() => {
    if (selectedFieldId) {
      setIsSpacingOpen(false);
    }
  }, [selectedFieldId]);

  useEffect(() => {
    if (selectedFieldId && isInspectorOpen && mode === 'design') {
      (document.activeElement as HTMLElement | null)?.blur();
    }
  }, [selectedFieldId, isInspectorOpen, mode]);

  useEffect(() => {
    if (isLivePreview) {
      setIsInspectorOpen(false);
    }
  }, [isLivePreview]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (isLivePreview && previewDevice !== 'desktop') {
      const previewScrollElement = previewScrollRef.current;
      if (!previewScrollElement) {
        return;
      }

      const updatePreviewScrollJumpState = () => {
        const { scrollTop, scrollHeight, clientHeight } = previewScrollElement;
        const remainingDistance = scrollHeight - clientHeight - scrollTop;
        const bottomThreshold = Math.min(320, Math.max(120, Math.round(clientHeight * 0.35)));

        setIsScrollJumpVisible(scrollHeight - clientHeight > 80);
        setIsScrollJumpUp(remainingDistance <= bottomThreshold);
      };

      updatePreviewScrollJumpState();
      previewScrollElement.addEventListener('scroll', updatePreviewScrollJumpState, {
        passive: true,
      });
      window.addEventListener('resize', updatePreviewScrollJumpState);

      return () => {
        previewScrollElement.removeEventListener('scroll', updatePreviewScrollJumpState);
        window.removeEventListener('resize', updatePreviewScrollJumpState);
      };
    }

    const updateScrollJumpState = () => {
      const scrollTop = window.scrollY || window.pageYOffset || 0;
      const scrollHeight = document.documentElement.scrollHeight;
      const clientHeight = window.innerHeight;
      const remainingDistance = scrollHeight - clientHeight - scrollTop;
      const bottomThreshold = Math.min(320, Math.max(120, Math.round(clientHeight * 0.35)));

      setIsScrollJumpVisible(scrollHeight - clientHeight > 80);
      setIsScrollJumpUp(remainingDistance <= bottomThreshold);
    };

    updateScrollJumpState();
    window.addEventListener('scroll', updateScrollJumpState, { passive: true });
    window.addEventListener('resize', updateScrollJumpState);

    return () => {
      window.removeEventListener('scroll', updateScrollJumpState);
      window.removeEventListener('resize', updateScrollJumpState);
    };
  }, [
    isInspectorOpen,
    isLivePreview,
    mode,
    previewDevice,
    template.fields.length,
    template.requestForm.enabled,
    template.resultCardShow,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const mediaQuery = window.matchMedia('(max-width: 900px)');
    const updateViewportMode = () => setIsOverlayViewport(mediaQuery.matches);

    updateViewportMode();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateViewportMode);
      return () => mediaQuery.removeEventListener('change', updateViewportMode);
    }

    mediaQuery.addListener(updateViewportMode);
    return () => mediaQuery.removeListener(updateViewportMode);
  }, []);

  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement || mode === 'formula') {
      return;
    }

    if (!hasHandledInitialCanvasSelectionRef.current) {
      hasHandledInitialCanvasSelectionRef.current = true;
      return;
    }

    const targetSelector =
      selectedFieldId === REQUEST_FORM_SELECTION_ID
        ? '[data-builder-request-form="true"]'
        : selectedFieldId === RESULT_CARD_SELECTION_ID
          ? '[data-builder-result-card="true"]'
          : selectedFieldId
            ? `[data-builder-field-id="${selectedFieldId}"]`
            : '[data-builder-request-form="true"]';
    const targetElement = canvasElement.querySelector<HTMLElement>(targetSelector);

    if (!targetElement) {
      return;
    }

    targetElement.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    });
  }, [mode, selectedFieldId]);

  useLayoutEffect(() => {
    const inspectorPanelElement = inspectorPanelRef.current;
    if (!inspectorPanelElement || !isInspectorOpen) {
      return;
    }

    inspectorPanelElement.scrollTop = 0;
    const frameId = window.requestAnimationFrame(() => {
      inspectorPanelElement.scrollTop = 0;
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isInspectorOpen, mode, selectedFieldId]);

  useLayoutEffect(() => {
    const libraryPanelElement = libraryPanelRef.current;
    if (!libraryPanelElement || !isLibraryOpen || mode === 'formula') {
      return;
    }

    libraryPanelElement.scrollTop = 0;
    const frameId = window.requestAnimationFrame(() => {
      libraryPanelElement.scrollTop = 0;
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isLibraryOpen, mode]);

  useEffect(() => {
    try {
      localStorage.setItem(BUILDER_AUTOSAVE_STORAGE_KEY, isAutoSaveEnabled ? '1' : '0');
    } catch {
      // Ignore storage write errors and keep working with in-memory state.
    }
  }, [isAutoSaveEnabled]);

  const renderPreviewResultCard = (isEditable = false) =>
    template.resultCardShow !== false || isEditable ? (
      <div
        data-builder-result-card={isEditable ? 'true' : undefined}
        className={
          isEditable
            ? `builder-preview__field builder-preview__field_editable builder-preview__field_full builder-preview__result-card ${isResultCardSelected ? 'builder-preview__field_active' : ''} ${template.resultCardShow !== false ? '' : 'builder-preview__field_hidden'}`
            : 'builder-preview__result-card'
        }
        onClick={
          isEditable
            ? () => {
                setSelectedFieldId(RESULT_CARD_SELECTION_ID);
                setIsInspectorOpen(true);
                setMode('design');
              }
            : undefined
        }
      >
        {isEditable ? (
          <div className="builder-preview__field-toolbar builder-preview__field-toolbar_main">
            <span className="builder-preview__field-badge">Итог расчета</span>
            <div className="builder-preview__field-actions">
              <button
                className="builder-preview__field-action"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  updateTemplate({ resultCardShow: !(template.resultCardShow !== false) });
                }}
              >
                {template.resultCardShow !== false ? 'Скрыть' : 'Показать'}
              </button>
            </div>
          </div>
        ) : null}
        {template.resultCardShow !== false ? (
          <div className="result-card result-card_sticky builder-preview__result-sticky">
            <div className="result-card__content">
              {template.resultCardShowTitle !== false ? (
                <div className="result-card__eyebrow">{previewResultCardTitle}</div>
              ) : null}
              {template.resultCardShowTotal !== false ? (
                <div className="result-card__amount result-card__amount_compact">
                  {formatPreviewMoneyValue(previewCalculation.total)} ₽
                </div>
              ) : null}
              <div className="result-card__description">{previewResultCardDescription}</div>
            </div>
            {template.requestForm.enabled ? (
              <div className="result-card__actions">
                <button
                  className="calculator-request__submit result-card__submit"
                  type="button"
                  onClick={() => handlePreviewButtonAction('submit')}
                >
                  {template.requestForm.submitButtonText}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="builder-preview__request-empty">
            Карточка результата скрыта. Нажмите, чтобы открыть настройки справа.
          </div>
        )}
      </div>
    ) : null;

  useEffect(() => {
    return () => {
      if (saveToastTimeoutRef.current !== null) {
        window.clearTimeout(saveToastTimeoutRef.current);
      }
      if (autoSaveTimeoutRef.current !== null) {
        window.clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    if (!isAutoSaveEnabled) {
      if (autoSaveTimeoutRef.current !== null) {
        window.clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }
      return;
    }

    if (autoSaveTimeoutRef.current !== null) {
      window.clearTimeout(autoSaveTimeoutRef.current);
    }

    autoSaveTimeoutRef.current = window.setTimeout(() => {
      onSave(template);
      autoSaveTimeoutRef.current = null;
    }, 800);

    return () => {
      if (autoSaveTimeoutRef.current !== null) {
        window.clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }
    };
  }, [isAutoSaveEnabled, onSave, template]);

  useEffect(() => {
    if (!isTestMode) {
      setPreviewRequestFormValues({
        name: '',
        phone: '',
        comment: '',
      });
      setPreviewConsentChecked(false);
    }
  }, [isTestMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    let frameId = 0;
    const updateFloatingToggleTop = () => {
      frameId = 0;
      const topbarBottom = topbarRef.current?.getBoundingClientRect().bottom ?? 88;
      setFloatingToggleTop(Math.max(12, Math.round(topbarBottom + 10)));
    };

    const scheduleUpdate = () => {
      if (frameId !== 0) {
        return;
      }

      frameId = window.requestAnimationFrame(updateFloatingToggleTop);
    };

    scheduleUpdate();
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);

    return () => {
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }

      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, []);

  const updateTemplate = (patch: Partial<CalculatorTemplate>) => {
    const sanitizedPatch = sanitizeTemplatePatch(patch);

    setTemplate((current) => ({
      ...current,
      ...sanitizedPatch,
      updatedAt: new Date().toISOString(),
    }));
  };

  const showSaveToast = (status: string, duration = 1800) => {
    if (saveToastTimeoutRef.current !== null) {
      window.clearTimeout(saveToastTimeoutRef.current);
    }

    setSaveStatus(status);
    setSaveToastKey((current) => current + 1);
    saveToastTimeoutRef.current = window.setTimeout(() => {
      setSaveStatus((current) => (current === status ? '' : current));
      saveToastTimeoutRef.current = null;
    }, duration);
  };

  const updateFormulaDraft = (
    key: 'basePrice' | 'discount' | 'minPrice' | 'globalCoefficient',
    rawValue: string,
  ) => {
    const normalizedRawValue = sanitizeCalculationParameterInput(rawValue);

    setFormulaDrafts((current) => ({
      ...current,
      [key]: normalizedRawValue,
    }));
    setFormulaDraftErrors((current) => ({
      ...current,
      [key]: '',
    }));

    if (normalizedRawValue === '') {
      return;
    }

    const numericValue = Number(normalizedRawValue);
    if (!Number.isFinite(numericValue)) {
      return;
    }

    const nextValue = clampCalculationParameterValue(key, numericValue);
    updateTemplate({
      [key]: nextValue,
    } as Partial<CalculatorTemplate>);
  };

  const commitFormulaDraft = (
    key: 'basePrice' | 'discount' | 'minPrice' | 'globalCoefficient',
    fallbackValue: number,
  ) => {
    const draftValue = formulaDrafts[key].trim();
    const numericValue = draftValue === '' ? fallbackValue : Number(draftValue);
    const safeValue = Number.isFinite(numericValue) ? numericValue : fallbackValue;
    const nextValue = clampCalculationParameterValue(key, safeValue);
    const wasCorrected = draftValue !== '' && (!Number.isFinite(numericValue) || nextValue !== numericValue);

    setFormulaDrafts((current) => ({
      ...current,
      [key]: String(nextValue),
    }));
    setFormulaDraftErrors((current) => ({
      ...current,
      [key]: wasCorrected ? getCalculationParameterCorrectionMessage(key, nextValue) : '',
    }));

    updateTemplate({
      [key]: nextValue,
    } as Partial<CalculatorTemplate>);
  };

  const insertIntoCustomFormula = (snippet: string) => {
    const textarea = customFormulaRef.current;
    const currentValue = template.customFormula ?? '';

    if (!textarea) {
      updateTemplate({ customFormula: `${currentValue}${snippet}` });
      return;
    }

    const selectionStart = textarea.selectionStart ?? currentValue.length;
    const selectionEnd = textarea.selectionEnd ?? currentValue.length;
    const nextValue =
      currentValue.slice(0, selectionStart) + snippet + currentValue.slice(selectionEnd);
    const nextCursorPosition = selectionStart + snippet.length;

    updateTemplate({ customFormula: nextValue });

    window.requestAnimationFrame(() => {
      const nextTextarea = customFormulaRef.current;
      if (!nextTextarea) {
        return;
      }

      nextTextarea.focus();
      nextTextarea.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  };

  const updateField = (fieldId: string, patch: Partial<CalculatorField>) => {
    const sourceField = template.fields.find((field) => field.id === fieldId);
    if (!sourceField) {
      return;
    }

    const sanitizedPatch = sanitizeFieldPatch(patch, sourceField);
    const nextField = { ...sourceField, ...sanitizedPatch };
    const sourcePreviewKey = sourceField.key;
    const nextPreviewKey = nextField.key;
    const shouldSyncPreviewValue =
      sanitizedPatch.defaultValue !== undefined ||
      sanitizedPatch.min !== undefined ||
      sanitizedPatch.max !== undefined ||
      sanitizedPatch.step !== undefined ||
      sanitizedPatch.inputSubtype !== undefined ||
      sanitizedPatch.type !== undefined;

    setTemplate((current) => ({
      ...current,
      fields: current.fields.map((field) =>
        field.id === fieldId ? { ...field, ...sanitizedPatch } : field,
      ),
      updatedAt: new Date().toISOString(),
    }));

    setPreviewValues((current) => {
      const nextValues = { ...current };
      const currentPreviewValue = current[sourcePreviewKey];
      const sourceDefaultPreviewValue = getPreviewFieldValue(sourceField);

      if (sourcePreviewKey !== nextPreviewKey) {
        if (currentPreviewValue !== undefined) {
          nextValues[nextPreviewKey] = currentPreviewValue;
        }
        delete nextValues[sourcePreviewKey];
      }

      if (
        shouldSyncPreviewValue &&
        (currentPreviewValue === undefined ||
          String(currentPreviewValue) === String(sourceDefaultPreviewValue))
      ) {
        nextValues[nextPreviewKey] = getPreviewFieldValue(nextField);
      }

      return nextValues;
    });
  };

  const handleImageUpload = (fieldId: string, file?: File) => {
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) {
        return;
      }

      updateField(fieldId, {
        imageUrl: result,
        imageAlt: file.name.replace(/\.[^.]+$/, '') || '\u0418\u043b\u043b\u044e\u0441\u0442\u0440\u0430\u0446\u0438\u044f',
      });
    };
    reader.readAsDataURL(file);
  };

  const addSelectOption = (fieldId: string) => {
    const field = template.fields.find((item) => item.id === fieldId);
    const nextIndex = (field?.options?.length ?? 0) + 1;

    updateField(fieldId, {
      options: [
        ...(field?.options ?? []),
        {
          id: createRandomId(),
          label: '\u0412\u0430\u0440\u0438\u0430\u043d\u0442 ' + nextIndex,
          value: nextIndex * 100,
          description: '',
        },
      ],
    });
  };

  const updateSelectOption = (
    fieldId: string,
    optionId: string,
    patch: Partial<CalculatorFieldOption>,
  ) => {
    const field = template.fields.find((item) => item.id === fieldId);
    if (!field) {
      return;
    }

    const sanitizedPatch = sanitizeOptionPatch(patch);

    updateField(fieldId, {
      options: (field.options ?? []).map((option) =>
        option.id === optionId ? { ...option, ...sanitizedPatch } : option,
      ),
    });
  };

  const removeSelectOption = (fieldId: string, optionId: string) => {
    const field = template.fields.find((item) => item.id === fieldId);
    if (!field) {
      return;
    }

    const removedOption = field.options?.find((option) => option.id === optionId);
    const currentDefaultValue =
      field.type === 'checkbox' && Array.isArray(field.defaultValue)
        ? field.defaultValue.filter((value) => value !== optionId)
        : field.defaultValue;
    updateField(fieldId, {
      options: (field.options ?? []).filter((option) => option.id !== optionId),
      defaultValue:
        field.type === 'checkbox'
          ? currentDefaultValue
          : String(field.defaultValue ?? '') === String(removedOption?.value ?? '')
          ? ''
          : field.defaultValue,
    });
  };

  const moveSelectOption = (fieldId: string, draggedOption: string, targetOption: string) => {
    if (draggedOption === targetOption) {
      return;
    }

    const field = template.fields.find((item) => item.id === fieldId);
    if (!field?.options?.length) {
      return;
    }

    const nextOptions = [...field.options];
    const sourceIndex = nextOptions.findIndex((option) => option.id === draggedOption);
    const targetIndex = nextOptions.findIndex((option) => option.id === targetOption);

    if (sourceIndex === -1 || targetIndex === -1) {
      return;
    }

    const [movedOption] = nextOptions.splice(sourceIndex, 1);
    nextOptions.splice(targetIndex, 0, movedOption);

    updateField(fieldId, { options: nextOptions });
  };

  const toggleCheckboxDefaultOption = (field: CalculatorField, optionId: string, checked: boolean) => {
    const currentDefaultValue = Array.isArray(field.defaultValue)
      ? field.defaultValue.map(String)
      : field.defaultValue === true
        ? ['__primary__']
        : [];

    const nextDefaultValue = checked
      ? [...currentDefaultValue.filter((value) => value !== optionId), optionId]
      : currentDefaultValue.filter((value) => value !== optionId);

    updateField(field.id, { defaultValue: nextDefaultValue });
  };

  const toggleCheckboxPrimaryDefault = (field: CalculatorField, checked: boolean) => {
    const currentDefaultValue = Array.isArray(field.defaultValue)
      ? field.defaultValue.map(String).filter((value) => value !== '__primary__')
      : [];

    if ((field.options?.length ?? 0) > 0) {
      updateField(field.id, {
        defaultValue: checked ? ['__primary__', ...currentDefaultValue] : currentDefaultValue,
      });
      return;
    }

    updateField(field.id, { defaultValue: checked });
  };

  const openLibrary = () => {
    setIsLibraryOpen((current) => {
      const next = !current;
      if (next && isOverlayViewport) {
        setIsInspectorOpen(false);
      }
      return next;
    });
  };

  const syncVisualFormulaTokens = (tokens: VisualFormulaToken[]) => {
    const nextFormula = buildVisualFormulaString(tokens);
    updateTemplate({
      formulaMode: nextFormula ? 'custom' : template.formulaMode,
      customFormula: nextFormula,
      visualFormulaTokens: tokens,
    });
  };

  const addVisualFormulaToken = (token: VisualFormulaToken) => {
    const currentTokens = template.visualFormulaTokens ?? [];
    syncVisualFormulaTokens([...currentTokens, token]);
  };

  const removeVisualFormulaToken = (tokenId: string) => {
    syncVisualFormulaTokens((template.visualFormulaTokens ?? []).filter((token) => token.id !== tokenId));
  };

  const moveVisualFormulaToken = (tokenId: string, direction: -1 | 1) => {
    const currentTokens = [...(template.visualFormulaTokens ?? [])];
    const currentIndex = currentTokens.findIndex((token) => token.id === tokenId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= currentTokens.length) {
      return;
    }

    const [token] = currentTokens.splice(currentIndex, 1);
    currentTokens.splice(nextIndex, 0, token);
    syncVisualFormulaTokens(currentTokens);
  };

  const clearVisualFormula = () => {
    syncVisualFormulaTokens([]);
  };

  const applyVisualFormulaExample = (formula: string) => {
    const nextTokens = parseVisualFormulaTokens(formula, template.fields);
    syncVisualFormulaTokens(nextTokens);
  };

  const addVisualNumberToken = () => {
    const trimmedValue = formulaNumberDraft.trim();
    if (!trimmedValue) {
      return;
    }

    addVisualFormulaToken(createVisualFormulaToken('number', trimmedValue, trimmedValue));
    setFormulaNumberDraft('');
  };

  const setFormulaEditorMode = (nextMode: FormulaEditorMode) => {
    if (nextMode === template.formulaEditorMode) {
      return;
    }

    if (nextMode === 'visual') {
      const currentTokens =
        template.visualFormulaTokens && template.visualFormulaTokens.length > 0
          ? template.visualFormulaTokens
          : parseVisualFormulaTokens(template.customFormula, template.fields);
      updateTemplate({
        formulaEditorMode: 'visual',
        visualFormulaTokens: currentTokens,
        customFormula: currentTokens.length > 0 ? buildVisualFormulaString(currentTokens) : template.customFormula,
      });
      return;
    }

    updateTemplate({ formulaEditorMode: 'manual' });
  };

  const setFormulaMode = (nextMode: 'simple' | 'custom') => {
    if (nextMode === template.formulaMode) {
      return;
    }

    if (nextMode === 'simple') {
      updateTemplate({ formulaMode: 'simple' });
      return;
    }

    const nextTokens =
      template.visualFormulaTokens && template.visualFormulaTokens.length > 0
        ? template.visualFormulaTokens
        : parseVisualFormulaTokens(template.customFormula, template.fields);
    updateTemplate({
      formulaMode: 'custom',
      formulaEditorMode: template.formulaEditorMode ?? 'visual',
      visualFormulaTokens: nextTokens,
      customFormula:
        template.customFormula.trim() || (nextTokens.length > 0 ? buildVisualFormulaString(nextTokens) : ''),
    });
  };

  const openInspector = () => {
    setIsInspectorOpen((current) => {
      const next = !current;
      if (next && isOverlayViewport) {
        setIsLibraryOpen(false);
      }
      return next;
    });
  };

  const selectField = (fieldId: string) => {
    setSelectedFieldId(fieldId);
    setIsPreview(false);
    setMode('design');
    if (isOverlayViewport) {
      setIsLibraryOpen(false);
    }
    setIsInspectorOpen(true);
  };

  const addField = (item: BuilderLibraryItem) => {
    if (!item.supported) {
      return;
    }

    if (item.onAdd) {
      item.onAdd(template, updateTemplate);
      setIsLibraryOpen(false);
      setIsPreview(false);
      setMode('design');
      setIsInspectorOpen(true);
      setSelectedFieldId(REQUEST_FORM_SELECTION_ID);
      return;
    }

    if (!item.createField) {
      return;
    }

    const nextField = item.createField();
    setTemplate((current) => ({
      ...current,
      fields: [...current.fields, nextField],
      updatedAt: new Date().toISOString(),
    }));
    setSelectedFieldId(nextField.id);
    setIsLibraryOpen(false);
    setIsInspectorOpen(true);
    setMode('design');
    setIsPreview(false);
  };

  useEffect(() => {
    const nextFieldIds = template.fields.map((field) => field.id);

    if (!hasTrackedFieldInsertionsRef.current) {
      hasTrackedFieldInsertionsRef.current = true;
      previousFieldIdsRef.current = nextFieldIds;
      return;
    }

    const previousFieldIdSet = new Set(previousFieldIdsRef.current);
    const addedFieldIds = nextFieldIds.filter((fieldId) => !previousFieldIdSet.has(fieldId));

    if (addedFieldIds.length > 0) {
      setFieldEntranceDelays((current) => {
        const next = { ...current };

        addedFieldIds.forEach((fieldId, index) => {
          next[fieldId] = index * 40;
        });

        return next;
      });

      addedFieldIds.forEach((fieldId, index) => {
        const timeoutId = window.setTimeout(() => {
          setFieldEntranceDelays((current) => {
            if (!(fieldId in current)) {
              return current;
            }

            const next = { ...current };
            delete next[fieldId];
            return next;
          });
        }, 360 + index * 40);

        staggerTimeoutsRef.current.push(timeoutId);
      });
    }

    previousFieldIdsRef.current = nextFieldIds;
  }, [template.fields]);

  useEffect(() => {
    const didAddField = template.fields.length > previousFieldCountRef.current;
    const didEnableRequestForm =
      template.requestForm.enabled && !previousRequestFormEnabledRef.current;

    if (didAddField || didEnableRequestForm) {
      setIsLibraryOpen(false);
    }

    previousFieldCountRef.current = template.fields.length;
    previousRequestFormEnabledRef.current = template.requestForm.enabled;
  }, [template.fields.length, template.requestForm.enabled]);

  useEffect(() => {
    return () => {
      staggerTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, []);

  const duplicateField = (fieldId: string) => {
    const sourceField = template.fields.find((field) => field.id === fieldId);
    const sourceIndex = template.fields.findIndex((field) => field.id === fieldId);
    if (!sourceField || sourceIndex === -1) {
      return;
    }

    const duplicatedField = {
      ...duplicateFieldConfig(sourceField),
      key: createUniqueFieldKey(template.fields, sourceField.key.replace(/_[a-z0-9]{4,7}$/i, '')),
      label: sourceField.label ? `${sourceField.label} копия` : 'Копия',
    };

    setTemplate((current) => {
      const nextFields = [...current.fields];
      nextFields.splice(sourceIndex + 1, 0, duplicatedField);

      return {
        ...current,
        fields: normalizeFieldLayouts(nextFields),
        updatedAt: new Date().toISOString(),
      };
    });
    setSelectedFieldId(duplicatedField.id);
    setIsInspectorOpen(true);
    setMode('design');
    setIsPreview(false);
  };

  const removeField = (fieldId: string) => {
    setTemplate((current) => ({
      ...current,
      fields: normalizeFieldLayouts(current.fields.filter((field) => field.id !== fieldId)),
      updatedAt: new Date().toISOString(),
    }));
    setSelectedFieldId((current) => (current === fieldId ? null : current));
    if (selectedFieldId === fieldId) {
      setIsInspectorOpen(false);
    }
  };

  const moveField = (
    sourceFieldId: string,
    targetFieldId: string,
    placement: 'before' | 'after' | 'left' | 'right',
  ) => {
    if (sourceFieldId === targetFieldId) {
      return;
    }

    setTemplate((current) => {
      const sourceIndex = current.fields.findIndex((field) => field.id === sourceFieldId);

      if (sourceIndex === -1) {
        return current;
      }

      const nextFields = [...current.fields];
      const [movedField] = nextFields.splice(sourceIndex, 1);
      const targetIndex = nextFields.findIndex((field) => field.id === targetFieldId);

      if (targetIndex === -1) {
        return current;
      }

      const targetField = nextFields[targetIndex];

      if (placement === 'left' || placement === 'right') {
        movedField.layout = 'half';
        nextFields[targetIndex] = { ...targetField, layout: 'half' };
      } else {
        movedField.layout = 'full';
      }

      const insertIndex =
        placement === 'before' || placement === 'left' ? targetIndex : targetIndex + 1;

      nextFields.splice(insertIndex, 0, movedField);

      return {
        ...current,
        fields: normalizeFieldLayouts(nextFields),
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const startFieldDrag = (fieldId: string) => {
    setDraggedFieldId(fieldId);
    setDragOverFieldId(fieldId);
    setDragOverPlacement('after');
  };

  const handleFieldDragOver = (
    event: React.DragEvent<HTMLElement>,
    fieldId: string,
  ) => {
    event.preventDefault();
    if (draggedFieldId === fieldId) {
      return;
    }

    setDragOverFieldId(fieldId);
    const bounds = event.currentTarget.getBoundingClientRect();
    const horizontalPoint = event.clientX - bounds.left;
    const verticalPoint = event.clientY - bounds.top;
    const leftZone = bounds.width * 0.35;
    const rightZone = bounds.width * 0.65;
    const topZone = bounds.height * 0.3;
    const bottomZone = bounds.height * 0.7;

    if (isOverlayViewport) {
      setDragOverPlacement(verticalPoint < bounds.height / 2 ? 'before' : 'after');
      return;
    }

    if (verticalPoint <= topZone) {
      setDragOverPlacement('before');
    } else if (verticalPoint >= bottomZone) {
      setDragOverPlacement('after');
    } else if (horizontalPoint <= leftZone) {
      setDragOverPlacement('left');
    } else if (horizontalPoint >= rightZone) {
      setDragOverPlacement('right');
    } else {
      setDragOverPlacement(verticalPoint < bounds.height / 2 ? 'before' : 'after');
    }
  };

  const finishFieldDrag = () => {
    setDraggedFieldId(null);
    setDragOverFieldId(null);
    setDragOverPlacement('after');
  };

  const startOptionDrag = (optionId: string) => {
    setDraggedOptionId(optionId);
    setDragOverOptionId(optionId);
  };

  const handleOptionDragOver = (event: React.DragEvent<HTMLElement>, optionId: string) => {
    event.preventDefault();
    if (draggedOptionId === optionId) {
      return;
    }

    setDragOverOptionId(optionId);
  };

  const finishOptionDrag = () => {
    setDraggedOptionId(null);
    setDragOverOptionId(null);
  };

  const handleSave = () => {
    onSave(template);
    showSaveToast('\u0421\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u043e');
  };

  const openJsonStorage = () => {
    setJsonDraft(JSON.stringify(normalizeTemplateContent(template), null, 2));
    setJsonError('');
    setIsJsonModalOpen(true);
  };

  const applyJsonStorage = () => {
    try {
      const parsedTemplate = JSON.parse(jsonDraft) as unknown;
      validateImportedTemplate(parsedTemplate);
      assertTemplateSystemFieldsUnchanged(parsedTemplate, template);
      const systemTemplateFields = {
        id: template.id,
        publicId: template.publicId,
        groupId: template.groupId,
        folderId: template.folderId,
        createdAt: template.createdAt,
        publicationStatus: template.publicationStatus,
        publishedAt: template.publishedAt,
        lastModifiedBy: template.lastModifiedBy,
      };
      const normalizedTemplate = normalizeTemplateContent({
        ...createEmptyTemplate(),
        ...parsedTemplate,
        ...systemTemplateFields,
        fields: Array.isArray(parsedTemplate.fields) ? parsedTemplate.fields : [],
        updatedAt: new Date().toISOString(),
      });

      setTemplate(normalizedTemplate);
      setSelectedFieldId((current) =>
        current && normalizedTemplate.fields.some((field) => field.id === current)
          ? current
          : normalizedTemplate.fields[0]?.id ?? null,
      );
      setJsonError('');
      setIsJsonModalOpen(false);
      setIsInspectorOpen(normalizedTemplate.fields.length > 0);
      setMode('design');
      setIsPreview(false);
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : 'Не удалось прочитать JSON');
    }
  };

  const copyJsonStorage = async () => {
    try {
      await copyTextToClipboard(jsonDraft);
      setJsonError('');
      showSaveToast('JSON скопирован');
    } catch {
      setJsonError('Не удалось скопировать JSON');
    }
  };

  const renderPanelToggleIcon = (side: 'left' | 'right') => (
    <span className={`builder-toggle-icon builder-toggle-icon_${side}`} aria-hidden="true">
      <span className="builder-toggle-icon__line builder-toggle-icon__line_top" />
      <span className="builder-toggle-icon__line builder-toggle-icon__line_middle" />
      <span className="builder-toggle-icon__line builder-toggle-icon__line_bottom" />
    </span>
  );

  const openFormulaMode = () => {
    setMode('formula');
    setIsPreview(false);
    setIsTestMode(false);
    setIsLibraryOpen(false);
    setIsInspectorOpen(true);
  };

  const scrollCanvasToEdge = () => {
    if (isLivePreview && previewDevice !== 'desktop') {
      const previewScrollElement = previewScrollRef.current;
      if (!previewScrollElement) {
        return;
      }

      previewScrollElement.scrollTo({
        top: isScrollJumpUp ? 0 : previewScrollElement.scrollHeight,
        behavior: 'smooth',
      });
      return;
    }

    if (typeof window === 'undefined') {
      return;
    }

    const scrollHeight = document.documentElement.scrollHeight;
    window.scrollTo({
      top: isScrollJumpUp ? 0 : scrollHeight,
      behavior: 'smooth',
    });
  };

  return (
    <div className="builder-shell builder-shell_editor">
      <header ref={topbarRef} className="builder-editor__topbar">
        <div className="builder-editor__topbar-left">
          <button className="builder-editor__back" type="button" onClick={onBack}>
            <Icon20ArrowLeftOutline />
            <span>{'\u041d\u0430\u0437\u0430\u0434'}</span>
          </button>

          <div className="builder-editor__mode-switch">
            <button
              className={`builder-editor__mode-button ${mode === 'design' ? 'builder-editor__mode-button_active' : ''}`}
              type="button"
              onClick={() => {
                if (mode === 'formula') {
                  setIsInspectorOpen(false);
                }
                setMode('design');
              }}
            >
              {'\u0414\u0438\u0437\u0430\u0439\u043d'}
            </button>
            <button
              className={`builder-editor__mode-button ${mode === 'formula' ? 'builder-editor__mode-button_active' : ''}`}
              type="button"
              onClick={openFormulaMode}
            >
              {'\u0424\u043e\u0440\u043c\u0443\u043b\u0430'}
            </button>
          </div>
        </div>

        <div className="builder-editor__topbar-right">
          <button
            className="builder-editor__ghost-button"
            type="button"
            onClick={openJsonStorage}
          >
            {'JSON проекта'}
          </button>
          <button
            className={`builder-editor__ghost-button ${isPreview ? 'builder-editor__ghost-button_active' : ''}`}
            type="button"
            onClick={() => {
              setIsPreview((value) => {
                const nextValue = !value;
                if (nextValue) {
                  setIsTestMode(false);
                  setMode('design');
                }
                return nextValue;
              });
            }}
          >
            {isPreview ? '\u0420\u0435\u0436\u0438\u043c \u0434\u0438\u0437\u0430\u0439\u043d\u0430' : '\u041f\u0440\u0435\u0434\u043f\u0440\u043e\u0441\u043c\u043e\u0442\u0440'}
          </button>
          <button
            className={`builder-editor__ghost-button ${isTestMode ? 'builder-editor__ghost-button_active' : ''}`}
            type="button"
            onClick={() => {
              setIsTestMode((value) => {
                const nextValue = !value;
                if (nextValue) {
                  setIsPreview(false);
                  setMode('design');
                }
                return nextValue;
              });
            }}
          >
            {isTestMode ? 'Выйти из теста' : 'Протестировать'}
          </button>
          <button className="builder-editor__save-button" type="button" onClick={handleSave}>
            {'\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c'}
          </button>
        </div>
      </header>

      {saveStatus ? (
        <div className="builder-editor__save-toast" aria-live="polite" aria-atomic="true">
          <div key={saveToastKey} className="builder-editor__save-toast-badge">
            {saveStatus}
          </div>
        </div>
      ) : null}

      <div
        className={`builder-editor ${isInspectorOpen ? 'builder-editor_with-inspector' : ''} ${mode === 'formula' ? 'builder-editor_formula' : ''}`}
        style={{ '--builder-floating-toggle-top': `${floatingToggleTop}px` } as React.CSSProperties}
      >
        <aside className={`builder-library ${isLibraryOpen ? 'builder-library_open' : 'builder-library_closed'}`}>
          <div ref={libraryPanelRef} className="builder-library__panel">
            <div className="builder-library__head">
              <div className='builder-library__eyebrow'>{'\u0411\u0438\u0431\u043b\u0438\u043e\u0442\u0435\u043a\u0430'}</div>
              <h2 className='builder-library__title'>{'\u042d\u043b\u0435\u043c\u0435\u043d\u0442\u044b'}</h2>
              {isOverlayViewport ? (
                <button
                  className="builder-panel-close"
                  type="button"
                  aria-label="Скрыть библиотеку"
                  onClick={openLibrary}
                >
                  {'Закрыть'}
                </button>
              ) : null}
            </div>

            <div className="builder-library__list">
              {preparedLibraryItems.map((item) => {
                const Icon = item.icon;
                const isRequestFormItem = item.id === 'request-form';
                const isRequestFormEnabled = isRequestFormItem ? template.requestForm.enabled : false;
                return (
                  <div
                    key={item.id}
                    className={`builder-library__item ${!item.supported ? 'builder-library__item_disabled' : ''} ${isRequestFormEnabled ? 'builder-library__item_active' : ''}`}
                  >
                    <span className={`builder-library__icon ${item.accent}`}>
                      <Icon />
                    </span>
                    <span className="builder-library__label">
                      {item.label}
                      {isRequestFormItem ? (
                        <span className="builder-library__meta">
                          {isRequestFormEnabled ? 'Включен' : 'Выключен'}
                        </span>
                      ) : null}
                    </span>
                    <button
                      className="builder-library__dots"
                      type="button"
                      aria-label={`Добавить блок ${item.label}`}
                      onClick={() => addField(item)}
                      disabled={!item.supported}
                    >
                      {isRequestFormItem ? (isRequestFormEnabled ? '-' : '+') : '+'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>

        {mode !== 'formula' && !isLivePreview && !(isOverlayViewport && isLibraryOpen) ? (
        <button
          className={`builder-library__toggle builder-floating-toggle_legacy ${isLibraryOpen ? 'builder-library__toggle_open' : ''}`}
          type="button"
          aria-label={isLibraryOpen ? '\u0421\u043a\u0440\u044b\u0442\u044c \u0431\u0438\u0431\u043b\u0438\u043e\u0442\u0435\u043a\u0443' : '\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u0431\u0438\u0431\u043b\u0438\u043e\u0442\u0435\u043a\u0443'}
          onClick={openLibrary}
        >
          {renderPanelToggleIcon('left')}
        </button>
        ) : null}

        <main
          ref={canvasRef}
          className={`builder-canvas ${isInspectorVisible ? 'builder-canvas_compact' : 'builder-canvas_expanded'}`}
        >
          <div className={`builder-canvas__board ${isInspectorVisible ? 'builder-canvas__board_compact' : 'builder-canvas__board_expanded'}`}>
            {mode !== 'formula' ? (
              <button
                className={`builder-library__toggle ${isLibraryOpen ? 'builder-library__toggle_open' : ''}`}
                type="button"
                aria-label={isLibraryOpen ? '\u0421\u043a\u0440\u044b\u0442\u044c \u0431\u0438\u0431\u043b\u0438\u043e\u0442\u0435\u043a\u0443' : '\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u0431\u0438\u0431\u043b\u0438\u043e\u0442\u0435\u043a\u0443'}
                onClick={openLibrary}
              >
                {renderPanelToggleIcon('left')}
              </button>
            ) : null}
            {mode !== 'formula' ? (
              <button
                className={`builder-inspector__toggle ${isInspectorVisible ? 'builder-inspector__toggle_open' : ''} ${!selectedField ? 'builder-inspector__toggle_muted' : ''}`}
                type="button"
                aria-label={isInspectorVisible ? '\u0421\u043a\u0440\u044b\u0442\u044c \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438' : '\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438'}
                onClick={openInspector}
              >
                {renderPanelToggleIcon('right')}
              </button>
            ) : null}
            <div className={`builder-canvas__toolbar ${isInspectorVisible ? 'builder-canvas__toolbar_compact' : 'builder-canvas__toolbar_expanded'}`}>
              {!isLivePreview && mode !== 'formula' ? (
                <>
              <div className="builder-canvas__field-group">
              <input
                className="builder-canvas__title-input"
                value={template.title}
                maxLength={MAX_TEMPLATE_TITLE_LENGTH}
                onChange={(event) =>
                  updateTemplate({ title: clampTemplateTitle(event.target.value) })
                }
                placeholder={'\u041d\u0430\u0437\u0432\u0430\u043d\u0438\u0435 \u043a\u0430\u043b\u044c\u043a\u0443\u043b\u044f\u0442\u043e\u0440\u0430'}
              />
                <div className="builder-canvas__field-counter">
                  {template.title.length} / {MAX_TEMPLATE_TITLE_LENGTH} {'\u0441\u0438\u043c\u0432.'}
                </div>
              </div>
              <div className="builder-canvas__field-group">
              <input
                className="builder-canvas__subtitle-input"
                value={template.description}
                maxLength={MAX_TEMPLATE_DESCRIPTION_LENGTH}
                onChange={(event) =>
                  updateTemplate({
                    description: clampTemplateDescription(event.target.value),
                  })
                }
                placeholder={'\u041a\u0440\u0430\u0442\u043a\u043e\u0435 \u043e\u043f\u0438\u0441\u0430\u043d\u0438\u0435'}
              />
                <div className="builder-canvas__field-counter">
                  {template.description.length} / {MAX_TEMPLATE_DESCRIPTION_LENGTH} {'\u0441\u0438\u043c\u0432.'}
                </div>
              </div>
                </>
              ) : null}
              {!isLivePreview && mode === 'design' && template.fields.length > 0 ? (
                <div className='builder-canvas__drag-hint'>{'\u0417\u0430\u0436\u043c\u0438\u0442\u0435 \u0438 \u043f\u0435\u0440\u0435\u0442\u0430\u0449\u0438\u0442\u0435 \u0431\u043b\u043e\u043a'}</div>
              ) : null}
              <div className="builder-canvas__status-row">
                <span className="builder-canvas__pill">
                  {formatBlockCountLabel(template.fields.length)}
                </span>
                <span className="builder-canvas__pill builder-canvas__pill_soft">
                  {template.requestForm.enabled ? 'Заявка включена' : 'Заявка выключена'}
                </span>
                <span className="builder-canvas__pill builder-canvas__pill_soft">
                  {mode === 'formula'
                    ? '\u0420\u0435\u0436\u0438\u043c \u0444\u043e\u0440\u043c\u0443\u043b\u044b'
                    : isTestMode
                      ? 'Тестовый режим'
                      : isPreview
                        ? '\u041f\u0440\u0435\u0434\u043f\u0440\u043e\u0441\u043c\u043e\u0442\u0440'
                        : '\u0420\u0435\u0436\u0438\u043c \u0434\u0438\u0437\u0430\u0439\u043d\u0430'}
                </span>
                <label className="builder-canvas__autosave">
                  <input
                    className="builder-canvas__autosave-input"
                    type="checkbox"
                    checked={isAutoSaveEnabled}
                    onChange={(event) => setIsAutoSaveEnabled(event.target.checked)}
                  />
                  <span className="builder-canvas__autosave-slider" aria-hidden="true" />
                  <span className="builder-canvas__autosave-label">
                    {'Автосохранение '}
                    {isAutoSaveEnabled ? 'вкл.' : 'выкл.'}
                  </span>
                </label>
              </div>
            </div>

            <div className={`builder-canvas__scene ${isInspectorVisible ? 'builder-canvas__scene_compact' : 'builder-canvas__scene_expanded'}`}>
              {isLivePreview ? (
                <div className={`builder-preview-shell ${isTestMode ? 'builder-preview-shell_test' : ''}`}>
                  <div className="builder-preview-devices" role="tablist" aria-label="Размер предпросмотра">
                    {(Object.entries(PREVIEW_DEVICE_CONFIG) as Array<[PreviewDevice, (typeof PREVIEW_DEVICE_CONFIG)[PreviewDevice]]>).map(
                      ([device, config]) => (
                        <button
                          key={device}
                          className={`builder-preview-devices__button ${previewDevice === device ? 'builder-preview-devices__button_active' : ''}`}
                          type="button"
                          role="tab"
                          aria-selected={previewDevice === device}
                          onClick={() => setPreviewDevice(device)}
                        >
                          <span
                            className={`builder-preview-devices__icon builder-preview-devices__icon_${device}`}
                            aria-hidden="true"
                          />
                          <span className="builder-preview-devices__label">{config.label}</span>
                        </button>
                      ),
                    )}
                  </div>
                <div className={`builder-preview-workspace ${isTestMode ? 'builder-preview-workspace_test' : ''}`}>
                  <div
                    className={`builder-preview-frame builder-preview-frame_${previewDevice}`}
                    style={
                      {
                        '--builder-preview-width':
                          typeof PREVIEW_DEVICE_CONFIG[previewDevice].width === 'number'
                            ? `${PREVIEW_DEVICE_CONFIG[previewDevice].width}px`
                            : PREVIEW_DEVICE_CONFIG[previewDevice].width,
                        '--builder-preview-height':
                          typeof PREVIEW_DEVICE_CONFIG[previewDevice].height === 'number'
                            ? `${PREVIEW_DEVICE_CONFIG[previewDevice].height}px`
                            : 'auto',
                      } as React.CSSProperties
                    }
                  >
                    <div className="builder-preview-frame__screen">
                      <div
                        ref={previewDevice !== 'desktop' ? previewScrollRef : null}
                        className={`builder-preview builder-preview_device_${previewDevice} ${previewDevice !== 'desktop' ? 'builder-preview_embedded-scroll' : ''}`}
                      >
                        <div className="builder-preview__header">
                          {previewDevice !== 'desktop' ? (
                            <button className="builder-preview__back" type="button" onClick={onBack}>
                              <Icon20ArrowLeftOutline />
                              <span>Назад</span>
                            </button>
                          ) : null}
                          <h3 className='builder-preview__title'>{template.title || '\u0411\u0435\u0437 \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u044f'}</h3>
                          <p className="builder-preview__description">
                            {template.description || '\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u043f\u043e\u044f\u0432\u0438\u0442\u0441\u044f \u0437\u0434\u0435\u0441\u044c'}
                          </p>
                        </div>
                        <div className="builder-preview__fields">
                          {template.fields.length > 0 ? (
                            template.fields.map((field) => (
                              <div
                                key={field.id}
                                className={`builder-preview__field builder-preview__field_${field.layout === 'half' ? 'half' : 'full'} ${fieldEntranceDelays[field.id] != null ? 'builder-preview__field_entering' : ''}`}
                                style={
                                  {
                                    ...getFieldSpacingStyle(field),
                                    '--builder-field-enter-delay': `${fieldEntranceDelays[field.id] ?? 0}ms`,
                                  } as React.CSSProperties
                                }
                              >
                                <CalculatorFieldInput
                                  field={field}
                                  value={previewValues[field.key] ?? getPreviewFieldValue(field)}
                                  error={isPreviewValidationTriggered ? previewErrors[field.key] : ''}
                                  isFormValid={isPreviewFormValid}
                                  template={template}
                                  allValues={previewValues}
                                  isCalculationTriggered
                                  onButtonAction={(action) => handlePreviewButtonAction(action)}
                                  onChange={(value) =>
                                    setPreviewValues((current) => {
                                      const nextValues = {
                                        ...current,
                                        [field.key]: value,
                                      };

                                      if (isPreviewValidationTriggered) {
                                        const nextErrors = { ...previewErrors };
                                        const nextError = validatePreviewFieldValue(field, value);
                                        if (nextError) {
                                          nextErrors[field.key] = nextError;
                                        } else {
                                          delete nextErrors[field.key];
                                        }
                                        setPreviewErrors(nextErrors);
                                      }

                                      setPreviewStatus('');
                                      return nextValues;
                                    })
                                  }
                                />
                              </div>
                            ))
                          ) : (
                            <div className="builder-empty-state">
                              {'\u0414\u043e\u0431\u0430\u0432\u044c\u0442\u0435 \u044d\u043b\u0435\u043c\u0435\u043d\u0442\u044b \u0438\u0437 \u0431\u0438\u0431\u043b\u0438\u043e\u0442\u0435\u043a\u0438, \u0447\u0442\u043e\u0431\u044b \u0443\u0432\u0438\u0434\u0435\u0442\u044c \u043f\u0440\u0435\u0434\u043f\u0440\u043e\u0441\u043c\u043e\u0442\u0440.'}
                            </div>
                          )}
                          {template.requestForm.enabled ? (
                            <div className="builder-preview__request-block">
                              <div className="calculator-panel__head">
                                <h2 className="calculator-panel__title">{template.requestForm.title}</h2>
                                <div className="calculator-panel__caption">
                                  {template.requestForm.description}
                                </div>
                              </div>
                              <div className="calculator-request">
                                <label className="calc-field">
                                  <span className="calc-field__label">{template.requestForm.nameLabel}</span>
                                  <input
                                    className="calc-field__control"
                                    value={previewRequestFormValues.name}
                                    placeholder={template.requestForm.namePlaceholder}
                                    readOnly={!isTestMode}
                                    onChange={(event) =>
                                      setPreviewRequestFormValues((current) => ({
                                        ...current,
                                        name: event.target.value,
                                      }))
                                    }
                                  />
                                </label>
                                <label className="calc-field">
                                  <span className="calc-field__label">{template.requestForm.phoneLabel}</span>
                                  <input
                                    className="calc-field__control"
                                    value={previewRequestFormValues.phone}
                                    placeholder={template.requestForm.phonePlaceholder}
                                    readOnly={!isTestMode}
                                    onChange={(event) =>
                                      setPreviewRequestFormValues((current) => ({
                                        ...current,
                                        phone: event.target.value,
                                      }))
                                    }
                                  />
                                </label>
                              <label className="calc-field">
                                <span className="calc-field__label">{template.requestForm.commentLabel}</span>
                                <textarea
                                  className="calc-field__control calc-field__control_textarea"
                                  value={previewRequestFormValues.comment}
                                  maxLength={250}
                                  placeholder={template.requestForm.commentPlaceholder}
                                  readOnly={!isTestMode}
                                  onChange={(event) =>
                                    setPreviewRequestFormValues((current) => ({
                                      ...current,
                                      comment: event.target.value,
                                    }))
                                  }
                                />
                                <span className="calc-field__hint">
                                  {previewRequestFormValues.comment.length} / 250
                                </span>
                              </label>
                              <label className="calculator-request__consent">
                                <span className="calculator-request__consent-row">
                                  <input
                                    className="calculator-request__consent-checkbox"
                                    type="checkbox"
                                    checked={previewConsentChecked}
                                    onChange={(event) => setPreviewConsentChecked(event.target.checked)}
                                  />
                                  <span className="calculator-request__consent-text">
                                    Я принимаю{' '}
                                    <button
                                      className="calculator-request__consent-link"
                                      type="button"
                                      onClick={() => setActiveLegalDoc('agreement')}
                                    >
                                      пользовательское соглашение
                                    </button>{' '}
                                    и{' '}
                                    <button
                                      className="calculator-request__consent-link"
                                      type="button"
                                      onClick={() => setActiveLegalDoc('privacy')}
                                    >
                                      политику конфиденциальности
                                    </button>
                                  </span>
                                </span>
                              </label>
                              </div>
                            </div>
                          ) : null}
                          {renderPreviewResultCard()}
                        </div>
                      </div>
                      {isScrollJumpVisible && previewDevice !== 'desktop' ? (
                        <div className="builder-scroll-jump builder-scroll-jump_embedded">
                          <button
                            className={`builder-scroll-jump__button ${isScrollJumpUp ? 'builder-scroll-jump__button_up' : 'builder-scroll-jump__button_down'}`}
                            type="button"
                            title={isScrollJumpUp ? 'Вверх' : 'Вниз'}
                            aria-label={isScrollJumpUp ? 'Прокрутить вверх' : 'Прокрутить вниз'}
                            onClick={scrollCanvasToEdge}
                          >
                            <span aria-hidden="true">{isScrollJumpUp ? '↑' : '↓'}</span>
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {isTestMode ? (
                    <aside className="builder-test-panel">
                      <div className="builder-test-panel__section">
                        <div className="builder-test-panel__eyebrow">Тестовый режим</div>
                        <h3 className="builder-test-panel__title">Живой расчет</h3>
                        <p className="builder-test-panel__text">
                          Меняйте поля слева и сразу смотрите итог, значения и контекст формулы.
                        </p>
                      </div>
                      <div className="builder-test-panel__section">
                        <div className="builder-test-panel__summary">
                          <div>
                            <span className="builder-test-panel__label">Итог</span>
                            <strong className="builder-test-panel__amount">
                              {formatPreviewMoneyValue(previewCalculation.total)} ₽
                            </strong>
                          </div>
                          <span className="builder-test-panel__chip">
                            {template.formulaMode === 'custom' ? 'Своя формула' : 'Базовый расчет'}
                          </span>
                        </div>
                        <div className="builder-test-panel__metrics">
                          <div className="builder-test-panel__metric">
                            <span>Подытог</span>
                            <strong>{formatPreviewMoneyValue(previewCalculation.subtotal)} ₽</strong>
                          </div>
                          <div className="builder-test-panel__metric">
                            <span>Скидка</span>
                            <strong>{formatPreviewMoneyValue(previewCalculation.discountAmount)} ₽</strong>
                          </div>
                          <div className="builder-test-panel__metric">
                            <span>Мин. цена</span>
                            <strong>{formatPreviewMoneyValue(template.minPrice)} ₽</strong>
                          </div>
                        </div>
                        {previewFormulaState.error ? (
                          <div className="builder-test-panel__error">{previewFormulaState.error}</div>
                        ) : null}
                      </div>
                      <div className="builder-test-panel__section">
                        <div className="builder-test-panel__section-title">Текущие значения</div>
                        <div className="builder-test-panel__list">
                          {previewValueEntries.map((entry) => (
                            <div key={entry.id} className="builder-test-panel__row">
                              <span>{entry.label}</span>
                              <strong>{entry.value}</strong>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="builder-test-panel__section">
                        <div className="builder-test-panel__section-title">Контекст формулы</div>
                        <div className="builder-test-panel__list">
                          {Object.entries(previewFormulaContext).map(([key, value]) => (
                            <div key={key} className="builder-test-panel__row">
                              <span>{key}</span>
                              <strong>{formatResultNumber(value, 2, 'plain')}</strong>
                            </div>
                          ))}
                        </div>
                      </div>
                    </aside>
                  ) : null}
                </div>
                </div>
              ) : mode === 'formula' ? (
                <div className="builder-formula">
                  <div className="builder-formula__hero">
                    <div className="builder-formula__hero-copy">
                      <div className='builder-formula__eyebrow'>{'\u041b\u043e\u0433\u0438\u043a\u0430 \u0440\u0430\u0441\u0447\u0435\u0442\u0430'}</div>
                      <h2 className='builder-formula__title'>{'\u0424\u043e\u0440\u043c\u0443\u043b\u0430 \u0441\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u0438'}</h2>
                      <p className="builder-formula__text">
                        {'Сначала задайте базовые параметры, затем соберите выражение визуально или переключитесь в код для точечной правки.'}
                      </p>
                    </div>
                    <div className="builder-formula__controls">
                      <div className="builder-editor__mode-switch builder-formula__switch">
                        <button
                          className={`builder-editor__mode-button ${template.formulaMode === 'simple' ? 'builder-editor__mode-button_active' : ''}`}
                          type="button"
                          onClick={() => setFormulaMode('simple')}
                        >
                          Простой расчет
                        </button>
                        <button
                          className={`builder-editor__mode-button ${template.formulaMode === 'custom' ? 'builder-editor__mode-button_active' : ''}`}
                          type="button"
                          disabled={!canUseProFeatures}
                          onClick={() => setFormulaMode('custom')}
                        >
                          Своя формула
                        </button>
                      </div>
                      {template.formulaMode === 'custom' ? (
                        <div className="builder-editor__mode-switch builder-formula__switch">
                          <button
                            className={`builder-editor__mode-button ${(template.formulaEditorMode ?? 'visual') === 'visual' ? 'builder-editor__mode-button_active' : ''}`}
                            type="button"
                            disabled={!canUseProFeatures}
                            onClick={() => setFormulaEditorMode('visual')}
                          >
                            Визуально
                          </button>
                          <button
                            className={`builder-editor__mode-button ${template.formulaEditorMode === 'manual' ? 'builder-editor__mode-button_active' : ''}`}
                            type="button"
                            disabled={!canUseProFeatures}
                            onClick={() => setFormulaEditorMode('manual')}
                          >
                            Кодом
                          </button>
                        </div>
                      ) : null}
                      <div className="builder-formula__summary">
                        <span className="builder-formula__summary-chip">
                          {template.formulaMode === 'custom'
                            ? (template.formulaEditorMode ?? 'visual') === 'visual'
                              ? 'Своя формула: визуально'
                              : 'Своя формула: кодом'
                            : 'Простой расчет'}
                        </span>
                        <span className="builder-formula__summary-text">
                          Примеры формул скрыты по умолчанию и открываются только при необходимости.
                        </span>
                      </div>
                    </div>
                  </div>

                  <section className="builder-formula__panel builder-formula__panel_compact">
                    <div className="builder-formula__panel-head">
                      <div>
                        <div className="builder-formula__variables-title">Параметры расчёта</div>
                        <div className="builder-formula__builder-caption">
                          Эти значения влияют на итог независимо от того, строите вы формулу визуально или вручную.
                        </div>
                      </div>
                    </div>
                    <div className="builder-formula__grid">
                    <label className="builder-formula__field">
                      <span>{'\u0411\u0430\u0437\u043e\u0432\u0430\u044f \u0446\u0435\u043d\u0430'}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        maxLength={MAX_CALCULATION_FIELD_LENGTH}
                        value={formulaDrafts.basePrice}
                        onChange={(event) => updateFormulaDraft('basePrice', event.target.value)}
                        onBlur={() => commitFormulaDraft('basePrice', 0)}
                      />
                      <span className="builder-inspector__field-hint">
                        {formulaDraftErrors.basePrice || getCalculationParameterHint('basePrice')}
                      </span>
                    </label>
                    <label className="builder-formula__field">
                      <span>{'\u0421\u043a\u0438\u0434\u043a\u0430, %'}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        maxLength={MAX_CALCULATION_FIELD_LENGTH}
                        value={formulaDrafts.discount}
                        onChange={(event) => updateFormulaDraft('discount', event.target.value)}
                        onBlur={() => commitFormulaDraft('discount', 0)}
                      />
                      <span className="builder-inspector__field-hint">
                        {formulaDraftErrors.discount || getCalculationParameterHint('discount')}
                      </span>
                    </label>
                    <label className="builder-formula__field">
                      <span>{'\u041c\u0438\u043d\u0438\u043c\u0430\u043b\u044c\u043d\u0430\u044f \u0446\u0435\u043d\u0430'}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        maxLength={MAX_CALCULATION_FIELD_LENGTH}
                        value={formulaDrafts.minPrice}
                        onChange={(event) => updateFormulaDraft('minPrice', event.target.value)}
                        onBlur={() => commitFormulaDraft('minPrice', 0)}
                      />
                      <span className="builder-inspector__field-hint">
                        {formulaDraftErrors.minPrice || getCalculationParameterHint('minPrice')}
                      </span>
                    </label>
                    <label className="builder-formula__field">
                      <span>{'\u041a\u043e\u044d\u0444\u0444\u0438\u0446\u0438\u0435\u043d\u0442'}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        maxLength={MAX_CALCULATION_FIELD_LENGTH}
                        value={formulaDrafts.globalCoefficient}
                        onChange={(event) =>
                          updateFormulaDraft('globalCoefficient', event.target.value)
                        }
                        onBlur={() => commitFormulaDraft('globalCoefficient', 1)}
                      />
                      <span className="builder-inspector__field-hint">
                        {formulaDraftErrors.globalCoefficient ||
                          getCalculationParameterHint('globalCoefficient')}
                      </span>
                    </label>
                    </div>
                  </section>

                  {template.formulaMode === 'custom' ? (
                    (template.formulaEditorMode ?? 'visual') === 'visual' ? (
                      <div className="builder-formula__visual">
                        <div className="builder-formula__variables builder-formula__stack">
                          <div className="builder-formula__panel">
                          <span className='builder-formula__variables-title'>Переменные</span>
                          <div className="builder-formula__chips">
                            {formulaVariableTokens.map((token) => (
                              <button
                                key={token.value}
                                className="builder-formula__chip"
                                type="button"
                                disabled={!canUseProFeatures}
                                onClick={() => addVisualFormulaToken(createVisualFormulaToken('variable', token.value, token.label))}
                              >
                                {token.label}
                              </button>
                            ))}
                            {template.fields
                              .filter(isFormulaEligibleField)
                              .map((field) => (
                                <button
                                  key={field.id}
                                  className="builder-formula__chip"
                                  type="button"
                                  disabled={!canUseProFeatures}
                                  onClick={() =>
                                    addVisualFormulaToken(
                                      createVisualFormulaToken('field', getFormulaReference(field), getFormulaReference(field)),
                                    )
                                  }
                                >
                                  {getFormulaReference(field)}
                                </button>
                              ))}
                          </div>
                          </div>
                          <div className="builder-formula__panel">
                          <span className='builder-formula__variables-title'>Операторы</span>
                          <div className="builder-formula__chips builder-formula__chips_symbols">
                            {formulaOperatorChips.map((operator) => (
                              <button
                                key={operator}
                                className="builder-formula__chip builder-formula__chip_symbol"
                                type="button"
                                disabled={!canUseProFeatures}
                                onClick={() =>
                                  addVisualFormulaToken(
                                    createVisualFormulaToken(
                                      operator === '(' || operator === ')' ? 'paren' : 'operator',
                                      operator,
                                      operator,
                                    ),
                                  )
                                }
                              >
                                {operator}
                              </button>
                            ))}
                          </div>
                          </div>
                          <div className="builder-formula__panel">
                          <span className='builder-formula__variables-title'>Сравнения и условия</span>
                          <div className="builder-formula__chips builder-formula__chips_symbols">
                            {formulaComparatorChips.map((operator) => (
                              <button
                                key={operator}
                                className="builder-formula__chip builder-formula__chip_symbol"
                                type="button"
                                disabled={!canUseProFeatures}
                                onClick={() =>
                                  addVisualFormulaToken(createVisualFormulaToken('comparator', operator, operator))
                                }
                              >
                                {operator}
                              </button>
                            ))}
                            <button
                              className="builder-formula__chip builder-formula__chip_symbol"
                              type="button"
                              disabled={!canUseProFeatures}
                              onClick={() => addVisualFormulaToken(createVisualFormulaToken('comma', ',', ','))}
                            >
                              ,
                            </button>
                          </div>
                          <div className="builder-formula__chips">
                            {formulaFunctionChips.map((token) => (
                              <button
                                key={token.value}
                                className="builder-formula__chip builder-formula__chip_compact"
                                type="button"
                                disabled={!canUseProFeatures}
                                onClick={() => addVisualFormulaToken(createVisualFormulaToken('function', token.value, token.label))}
                              >
                                {token.label}
                              </button>
                            ))}
                          </div>
                          </div>
                          <div className="builder-formula__panel">
                          <span className='builder-formula__variables-title'>Число</span>
                          <div className="builder-formula__number-row">
                            <label className="builder-formula__field">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={formulaNumberDraft}
                                disabled={!canUseProFeatures}
                                onChange={(event) => setFormulaNumberDraft(event.target.value)}
                                placeholder="1000"
                              />
                            </label>
                            <button
                              className="builder-editor__ghost-button builder-formula__add-number"
                              type="button"
                              disabled={!canUseProFeatures || !formulaNumberDraft.trim()}
                              onClick={addVisualNumberToken}
                            >
                              Добавить число
                            </button>
                          </div>
                          </div>
                        </div>

                        <div className="builder-formula__builder builder-formula__stack">
                          <div className="builder-formula__preview-panel builder-formula__preview-panel_sticky">
                            <div className="builder-formula__preview-row">
                              <span>Выражение</span>
                              <strong>{visualFormulaExpression || '—'}</strong>
                            </div>
                            <div className="builder-formula__preview-row">
                              <span>Результат</span>
                              <strong>{formatResultNumber(previewFormulaState.value)} ₽</strong>
                            </div>
                            {previewFormulaSubstitution ? (
                              <div className="builder-formula__preview-substitution">
                                {previewFormulaSubstitution}
                              </div>
                            ) : null}
                            {previewFormulaState.error ? (
                              <div className="builder-formula__preview-error">{previewFormulaState.error}</div>
                            ) : null}
                          </div>
                          <div className="builder-formula__builder-head">
                            <div>
                              <div className="builder-formula__variables-title">Конструктор выражения</div>
                              <div className="builder-formula__builder-caption">
                                Добавляйте элементы по порядку. Для условий используйте `Если( условие , значение , значение )`.
                              </div>
                            </div>
                            <button
                              className="builder-editor__ghost-button builder-formula__clear"
                              type="button"
                              disabled={!canUseProFeatures || visualFormulaTokens.length === 0}
                              onClick={clearVisualFormula}
                            >
                              Очистить
                            </button>
                          </div>
                          <div className="builder-formula__token-list">
                            {visualFormulaTokens.length > 0 ? (
                              visualFormulaTokens.map((token, index) => (
                                <div key={token.id} className="builder-formula__token">
                                  <span className="builder-formula__token-index">{index + 1}</span>
                                  <span className="builder-formula__token-label">{token.label}</span>
                                  <div className="builder-formula__token-actions">
                                    <button
                                      className="builder-formula__token-action"
                                      type="button"
                                      disabled={index === 0}
                                      onClick={() => moveVisualFormulaToken(token.id, -1)}
                                    >
                                      ←
                                    </button>
                                    <button
                                      className="builder-formula__token-action"
                                      type="button"
                                      disabled={index === visualFormulaTokens.length - 1}
                                      onClick={() => moveVisualFormulaToken(token.id, 1)}
                                    >
                                      →
                                    </button>
                                    <button
                                      className="builder-formula__token-action builder-formula__token-action_danger"
                                      type="button"
                                      onClick={() => removeVisualFormulaToken(token.id)}
                                    >
                                      ×
                                    </button>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="builder-formula__empty">
                                Формула пока пустая. Добавьте поля, операторы и функции сверху.
                              </div>
                            )}
                          </div>
                          <div className="builder-formula__examples">
                            <div className="builder-formula__examples-head">
                              <div>
                                <div className="builder-formula__variables-title">Примеры формул</div>
                                <div className="builder-formula__builder-caption">
                                  Быстрые заготовки для типовых сценариев. Открывайте блок только когда нужен ориентир.
                                </div>
                              </div>
                              <button
                                className="builder-editor__ghost-button builder-formula__examples-toggle"
                                type="button"
                                onClick={() => setIsFormulaExamplesOpen((current) => !current)}
                              >
                                {isFormulaExamplesOpen ? 'Скрыть примеры' : 'Показать примеры'}
                              </button>
                            </div>
                            {isFormulaExamplesOpen ? (
                              <div className="builder-formula__examples-list">
                                {visualFormulaExamples.map((example) => (
                                  <button
                                    key={example.title}
                                    className="builder-formula__example"
                                    type="button"
                                    disabled={!canUseProFeatures}
                                    onClick={() => applyVisualFormulaExample(example.formula)}
                                  >
                                    <span className="builder-formula__example-title">{example.title}</span>
                                    <strong className="builder-formula__example-formula">{example.formula}</strong>
                                    <span className="builder-formula__example-text">{example.description}</span>
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="builder-formula__variables">
                          <span className='builder-formula__variables-title'>Доступные переменные</span>
                          <div className="builder-formula__chips">
                            <button
                              className="builder-formula__chip"
                              type="button"
                              disabled={!canUseProFeatures}
                              onClick={() => insertIntoCustomFormula('Базовая цена')}
                            >
                              Базовая цена
                            </button>
                            <button
                              className="builder-formula__chip"
                              type="button"
                              disabled={!canUseProFeatures}
                              onClick={() => insertIntoCustomFormula('Общий коэффициент')}
                            >
                              Общий коэффициент
                            </button>
                            {template.fields.filter(isFormulaEligibleField).map((field) => (
                              <button
                                key={field.id}
                                className="builder-formula__chip"
                                type="button"
                                disabled={!canUseProFeatures}
                                onClick={() => insertIntoCustomFormula(getFormulaReference(field))}
                              >
                                {getFormulaReference(field)}
                              </button>
                            ))}
                          </div>
                          <span className='builder-formula__variables-title'>Знаки</span>
                          <div className="builder-formula__chips builder-formula__chips_symbols">
                            {formulaOperatorChips.map((operator) => (
                              <button
                                key={operator}
                                className="builder-formula__chip builder-formula__chip_symbol"
                                type="button"
                                disabled={!canUseProFeatures}
                                onClick={() =>
                                  insertIntoCustomFormula(
                                    operator === '(' || operator === ')' ? operator : ` ${operator} `,
                                  )
                                }
                              >
                                {operator}
                              </button>
                            ))}
                          </div>
                        </div>

                        <label className="builder-formula__field builder-formula__field_full">
                          <span>Общая формула калькулятора</span>
                          <textarea
                            ref={customFormulaRef}
                            value={template.customFormula}
                            maxLength={MAX_FORMULA_EXPRESSION_LENGTH}
                            onChange={(event) =>
                              canUseProFeatures
                                ? updateTemplate({ customFormula: event.target.value })
                                : undefined
                            }
                            disabled={!canUseProFeatures}
                            placeholder={'Например: (Базовая цена + Количество) * Общий коэффициент'}
                          />
                          <span className="builder-inspector__field-hint">
                            До {MAX_FORMULA_EXPRESSION_LENGTH} символов. Используйте только доступные переменные ниже.
                          </span>
                        </label>
                        <div className="builder-formula__preview-panel">
                          <div className="builder-formula__preview-row">
                            <span>Результат</span>
                            <strong>{formatResultNumber(previewFormulaState.value)} ₽</strong>
                          </div>
                          {previewFormulaSubstitution ? (
                            <div className="builder-formula__preview-substitution">
                              {previewFormulaSubstitution}
                            </div>
                          ) : null}
                          {previewFormulaState.error ? (
                            <div className="builder-formula__preview-error">{previewFormulaState.error}</div>
                          ) : null}
                        </div>
                      </>
                    )
                  ) : (
                    <div className="builder-formula__simple-note">
                      Используется простой расчет: `(Базовая цена + сумма полей) × коэффициент`, затем применяется скидка и минимальная цена.
                    </div>
                  )}

                  {!canUseProFeatures ? (
                    <span className="builder-inspector__field-hint">
                      {proFeatureHint(
                        'Кастомная формула и визуальный редактор доступны на тарифе Про. В Базовом тарифе работает простой расчет.',
                      )}
                    </span>
                  ) : null}

                  {template.fields.filter((field) => field.type === 'result').map((field) => (
                    <div key={field.id} className="builder-formula__result-card">
                      <label className="builder-formula__field builder-formula__field_full">
                        <span>Формула блока результата</span>
                        <textarea
                          value={field.resultFormula ?? ''}
                          maxLength={MAX_FORMULA_EXPRESSION_LENGTH}
                          placeholder="area * price"
                          onChange={(event) =>
                            updateField(field.id, { resultFormula: event.target.value })
                          }
                        />
                        <span className="builder-inspector__field-hint">
                          {resultFieldFormulaErrors[field.id] ||
                            `До ${MAX_FORMULA_EXPRESSION_LENGTH} символов. Используйте доступные переменные калькулятора.`}
                        </span>
                      </label>

                      <div className="builder-formula__grid">
                        <label className="builder-formula__field">
                          <span>Префикс</span>
                          <input
                            value={field.resultPrefix ?? ''}
                            disabled={!canUseProFeatures}
                            onChange={(event) =>
                              updateField(field.id, { resultPrefix: event.target.value })
                            }
                          />
                        </label>

                        <label className="builder-formula__field">
                          <span>Суффикс</span>
                          <input
                            value={field.resultSuffix ?? ''}
                            disabled={!canUseProFeatures}
                            onChange={(event) =>
                              updateField(field.id, { resultSuffix: event.target.value })
                            }
                          />
                        </label>
                      </div>

                      <div className="builder-formula__grid">
                        <label className="builder-formula__field">
                          <span>Округление</span>
                          <select
                            value={field.resultRounding === false ? 'off' : 'on'}
                            disabled={!canUseProFeatures}
                            onChange={(event) =>
                              updateField(field.id, {
                                resultRounding: event.target.value === 'on',
                              })
                            }
                          >
                            <option value="on">Включено</option>
                            <option value="off">Выключено</option>
                          </select>
                        </label>

                        <label className="builder-formula__field">
                          <span>Знаков после запятой</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={field.resultDecimals ?? ''}
                            disabled={!canUseProFeatures}
                            onChange={(event) =>
                              updateField(field.id, {
                                resultDecimals:
                                  event.target.value === ''
                                    ? undefined
                                    : Math.min(6, Math.max(0, Number(event.target.value) || 0)),
                              })
                            }
                            onBlur={() =>
                              updateField(field.id, {
                                resultDecimals: field.resultDecimals ?? 0,
                              })
                            }
                          />
                        </label>
                      </div>

                      <div className="builder-formula__grid">
                        <label className="builder-formula__field">
                          <span>Формат числа</span>
                          <select
                            value={field.resultFormat ?? 'space'}
                            disabled={!canUseProFeatures}
                            onChange={(event) =>
                              updateField(field.id, {
                                resultFormat: event.target.value as NonNullable<CalculatorField['resultFormat']>,
                              })
                            }
                          >
                            <option value="space">1 234,56</option>
                            <option value="plain">1234.56</option>
                          </select>
                        </label>

                        <label className="builder-formula__field">
                          <span>Показ результата</span>
                          <select
                            value={field.resultDisplayMode ?? 'auto'}
                            disabled={!canUseProFeatures}
                            onChange={(event) =>
                              updateField(field.id, {
                                resultDisplayMode: event.target.value as NonNullable<CalculatorField['resultDisplayMode']>,
                              })
                            }
                          >
                            <option value="auto">Сразу</option>
                            <option value="after_button">После кнопки</option>
                          </select>
                        </label>
                      </div>
                      {!canUseProFeatures ? (
                        <div className="builder-inspector__field-hint">
                          {proFeatureHint(
                            'Префикс, суффикс, округление, формат и показ после кнопки доступны на тарифе Про.',
                          )}
                        </div>
                      ) : null}

                    </div>
                  ))}
                </div>
              ) : template.fields.length > 0 ||
                template.requestForm.enabled ||
                template.resultCardShow !== false ? (
                <div className="builder-preview builder-preview_design">
                  <div className="builder-preview__fields">
                  {template.fields.map((field) => (
                    <div
                      key={field.id}
                      data-builder-field-id={field.id}
                      className={`builder-preview__field builder-preview__field_editable builder-preview__field_${field.layout === 'half' ? 'half' : 'full'} ${selectedFieldId === field.id ? 'builder-preview__field_active' : ''} ${draggedFieldId === field.id ? 'builder-preview__field_dragging' : ''} ${dragOverFieldId === field.id ? `builder-preview__field_drop-target builder-preview__field_drop-${dragOverPlacement}` : ''} ${field.hidden ? 'builder-preview__field_hidden' : ''} ${fieldEntranceDelays[field.id] != null ? 'builder-preview__field_entering' : ''}`}
                      style={
                        {
                          ...getFieldSpacingStyle(field),
                          '--builder-field-enter-delay': `${fieldEntranceDelays[field.id] ?? 0}ms`,
                        } as React.CSSProperties
                      }
                      draggable
                      onClick={() => selectField(field.id)}
                      onDragStart={() => startFieldDrag(field.id)}
                      onDragOver={(event) => handleFieldDragOver(event, field.id)}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (draggedFieldId) {
                          moveField(draggedFieldId, field.id, dragOverPlacement);
                        }
                        finishFieldDrag();
                      }}
                      onDragEnd={finishFieldDrag}
                    >
                      <div className="builder-preview__field-toolbar builder-preview__field-toolbar_main">
                        <span className="builder-preview__field-badge">
                          {fieldTypeLabels[field.type]}
                        </span>
                        <div className="builder-preview__field-actions">
                          <button
                            className="builder-preview__field-action"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              duplicateField(field.id);
                            }}
                          >
                            {'Копия'}
                          </button>
                          <button
                            className="builder-preview__field-action"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              updateField(field.id, { hidden: !(field.hidden === true) });
                            }}
                          >
                            {field.hidden ? 'Показать' : 'Скрыть'}
                          </button>
                          <button
                            className="builder-preview__field-action builder-preview__field-action_danger"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setPendingDeleteFieldId(field.id);
                            }}
                          >
                            {'Удалить'}
                          </button>
                          <button
                            className="builder-preview__field-handle"
                            type="button"
                            aria-label={'\u041f\u0435\u0440\u0435\u0442\u0430\u0449\u0438\u0442\u044c \u0431\u043b\u043e\u043a'}
                            onClick={(event) => {
                              event.stopPropagation();
                              selectField(field.id);
                            }}
                          >
                            {'\u041f\u0435\u0440\u0435\u0442\u0430\u0449\u0438\u0442\u044c'}
                          </button>
                        </div>
                      </div>
                      <div
                        style={
                          selectedFieldId === field.id && isInspectorOpen
                            ? { pointerEvents: 'none' }
                            : undefined
                        }
                      >
                        <CalculatorFieldInput
                          field={field}
                          value={previewValues[field.key] ?? getPreviewFieldValue(field)}
                          isDesignMode
                          onBookingFieldChange={(patch) => updateField(field.id, patch)}
                          template={template}
                          allValues={previewValues}
                          isCalculationTriggered
                          onChange={(value) =>
                            setPreviewValues((current) => ({
                              ...current,
                              [field.key]: value,
                            }))
                          }
                        />
                      </div>
                      <div className="builder-field-card__top">
                        <span className="builder-field-card__type">{fieldTypeLabels[field.type]}</span>
                        <span className="builder-field-card__key">
                          {field.type === 'select' ? '\u0432\u0430\u0440\u0438\u0430\u043d\u0442\u044b' : '\u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0430'}
                        </span>
                      </div>
                      <div className="builder-field-card__label">{field.label}</div>
                      <div className="builder-field-card__meta">
                        <span>{field.required ? '\u041e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u043d\u043e\u0435' : '\u041d\u0435\u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u043d\u043e\u0435'}</span>
                        <span>
                          {field.type === 'button'
                            ? getButtonActionLabel(field.buttonAction)
                            : field.type === 'select'
                            ? '\u0441\u043f\u0438\u0441\u043e\u043a'
                            : field.type === 'booking'
                              ? `${field.bookingStartTime ?? '09:00'}-${field.bookingEndTime ?? '18:00'}`
                            : field.type === 'image'
                              ? '\u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435'
                            : field.type === 'checkbox'
                              ? getCheckboxPriceLabel(field)
                              : getInputSubtype(field) && getInputSubtype(field) !== 'number'
                                ? getInputSubtypeLabel(getInputSubtype(field) as InputFieldSubtype)
                              : field.unitPrice + ' \u20bd'}
                        </span>
                        {field.hidden ? <span>{'Скрыт'}</span> : null}
                      </div>
                    </div>
                  ))}
                  <div
                    data-builder-request-form="true"
                    className={`builder-preview__field builder-preview__field_editable builder-preview__field_full builder-preview__request-card ${isRequestFormSelected ? 'builder-preview__field_active' : ''} ${template.requestForm.enabled ? '' : 'builder-preview__field_hidden'}`}
                    onClick={() => {
                      setSelectedFieldId(REQUEST_FORM_SELECTION_ID);
                      setIsInspectorOpen(true);
                      setMode('design');
                    }}
                  >
                    <div className="builder-preview__field-toolbar builder-preview__field-toolbar_main">
                      <span className="builder-preview__field-badge">Блок заявки</span>
                      <div className="builder-preview__field-actions">
                        <button
                          className="builder-preview__field-action"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            updateTemplate({
                              requestForm: {
                                ...template.requestForm,
                                enabled: !template.requestForm.enabled,
                              },
                            });
                          }}
                        >
                          {template.requestForm.enabled ? 'Скрыть' : 'Показать'}
                        </button>
                      </div>
                    </div>

                    {template.requestForm.enabled ? (
                      <div className="builder-preview__request-block">
                        <div className="calculator-panel__head">
                          <h2 className="calculator-panel__title">{template.requestForm.title}</h2>
                          <div className="calculator-panel__caption">
                            {template.requestForm.description}
                          </div>
                        </div>
                        <div className="calculator-request">
                          <label className="calc-field">
                            <span className="calc-field__label">{template.requestForm.nameLabel}</span>
                            <input
                              className="calc-field__control"
                              value={previewRequestFormValues.name}
                              placeholder={template.requestForm.namePlaceholder}
                              readOnly={!isTestMode}
                              onChange={(event) =>
                                setPreviewRequestFormValues((current) => ({
                                  ...current,
                                  name: event.target.value,
                                }))
                              }
                            />
                          </label>
                          <label className="calc-field">
                            <span className="calc-field__label">{template.requestForm.phoneLabel}</span>
                            <input
                              className="calc-field__control"
                              value={previewRequestFormValues.phone}
                              placeholder={template.requestForm.phonePlaceholder}
                              readOnly={!isTestMode}
                              onChange={(event) =>
                                setPreviewRequestFormValues((current) => ({
                                  ...current,
                                  phone: event.target.value,
                                }))
                              }
                            />
                          </label>
                          <label className="calc-field">
                            <span className="calc-field__label">{template.requestForm.commentLabel}</span>
                            <textarea
                              className="calc-field__control calc-field__control_textarea"
                              value={previewRequestFormValues.comment}
                              maxLength={250}
                              placeholder={template.requestForm.commentPlaceholder}
                              readOnly={!isTestMode}
                              onChange={(event) =>
                                setPreviewRequestFormValues((current) => ({
                                  ...current,
                                  comment: event.target.value,
                                }))
                              }
                            />
                            <span className="calc-field__hint">
                              {previewRequestFormValues.comment.length} / 250
                            </span>
                          </label>
                          <label className="calculator-request__consent">
                            <span className="calculator-request__consent-row">
                              <input
                                className="calculator-request__consent-checkbox"
                                type="checkbox"
                                checked={previewConsentChecked}
                                readOnly={!isTestMode}
                                onChange={(event) => setPreviewConsentChecked(event.target.checked)}
                              />
                              <span className="calculator-request__consent-text">
                                Я принимаю{' '}
                                <button
                                  className="calculator-request__consent-link"
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setActiveLegalDoc('agreement');
                                  }}
                                >
                                  пользовательское соглашение
                                </button>{' '}
                                и{' '}
                                <button
                                  className="calculator-request__consent-link"
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setActiveLegalDoc('privacy');
                                  }}
                                >
                                  политику конфиденциальности
                                </button>
                              </span>
                            </span>
                          </label>
                        </div>
                      </div>
                    ) : (
                      <div className="builder-preview__request-empty">
                        Блок заявки выключен. Нажмите, чтобы открыть настройки справа.
                      </div>
                    )}
                  </div>
                  {renderPreviewResultCard(true)}
                  </div>
                </div>
              ) : (
                <div className="builder-canvas__dropzone">
                  <div className="builder-canvas__drop-icon">+</div>
                  <h1 className='builder-canvas__title'>{'\u0421\u043e\u0437\u0434\u0430\u0439\u0442\u0435 \u043f\u0435\u0440\u0432\u044b\u0439 \u0431\u043b\u043e\u043a'}</h1>
                  <p className="builder-canvas__text">
                    {'\u041e\u0442\u043a\u0440\u043e\u0439\u0442\u0435 \u0431\u0438\u0431\u043b\u0438\u043e\u0442\u0435\u043a\u0443 \u0441\u043b\u0435\u0432\u0430 \u0438 \u0434\u043e\u0431\u0430\u0432\u044c\u0442\u0435 \u044d\u043b\u0435\u043c\u0435\u043d\u0442 \u043d\u0430 \u043f\u043e\u043b\u043e\u0442\u043d\u043e.'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </main>

        {isScrollJumpVisible && (!isLivePreview || previewDevice === 'desktop') ? (
          <div
            className={`builder-scroll-jump ${isInspectorOpen && mode !== 'formula' && !isLivePreview ? 'builder-scroll-jump_with-inspector' : ''} ${isLivePreview ? 'builder-scroll-jump_preview' : ''}`}
          >
            <button
              className={`builder-scroll-jump__button ${isScrollJumpUp ? 'builder-scroll-jump__button_up' : 'builder-scroll-jump__button_down'}`}
              type="button"
              title={isScrollJumpUp ? 'Вверх' : 'Вниз'}
              aria-label={isScrollJumpUp ? 'Прокрутить вверх' : 'Прокрутить вниз'}
              onClick={scrollCanvasToEdge}
            >
              <span aria-hidden="true">{isScrollJumpUp ? '↑' : '↓'}</span>
            </button>
          </div>
        ) : null}

        {mode !== 'formula' && !isLivePreview && !(isOverlayViewport && isInspectorVisible) ? (
          <button
            className={`builder-inspector__toggle builder-floating-toggle_legacy ${isInspectorVisible ? 'builder-inspector__toggle_open' : ''} ${!selectedField && !isRequestFormSelected && !isResultCardSelected ? 'builder-inspector__toggle_muted' : ''}`}
            type="button"
            aria-label={isInspectorVisible ? '\u0421\u043a\u0440\u044b\u0442\u044c \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438' : '\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438'}
            onClick={openInspector}
          >
            {renderPanelToggleIcon('right')}
          </button>
        ) : null}

        <aside className={`builder-inspector ${isInspectorVisible ? 'builder-inspector_open' : 'builder-inspector_closed'}`}>
          <div ref={inspectorPanelRef} className="builder-inspector__panel">
          {isOverlayViewport ? (
            <div className="builder-inspector__panel-head">
              <button
                className="builder-panel-close builder-panel-close_right"
                type="button"
                aria-label="Скрыть настройки"
                onClick={openInspector}
              >
                {'Закрыть'}
              </button>
            </div>
          ) : null}
          {mode === 'formula' ? (
            <div className="builder-inspector__section">
              <div className="builder-inspector__eyebrow">{'\u0420\u0435\u0436\u0438\u043c \u0444\u043e\u0440\u043c\u0443\u043b\u044b'}</div>
              <h3 className="builder-inspector__title">{'\u0424\u043e\u0440\u043c\u0443\u043b\u0430 \u0440\u0430\u0441\u0447\u0435\u0442\u0430'}</h3>
              <p className="builder-inspector__text">
                {'\u0421\u043e\u0431\u0435\u0440\u0438\u0442\u0435 \u0432\u044b\u0440\u0430\u0436\u0435\u043d\u0438\u0435 \u0438\u0437 \u043f\u043e\u043b\u0435\u0439, \u0447\u0438\u0441\u0435\u043b \u0438 \u043e\u043f\u0435\u0440\u0430\u0442\u043e\u0440\u043e\u0432. \u0420\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442 \u0431\u0443\u0434\u0435\u0442 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u044c\u0441\u044f \u0432 \u0438\u0442\u043e\u0433\u043e\u0432\u043e\u0439 \u0441\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u0438.'}
              </p>
            </div>
          ) : selectedField ? (
            <>
              <div className="builder-inspector__section">
                <div className="builder-inspector__eyebrow">{'\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438 \u0431\u043b\u043e\u043a\u0430'}</div>
                <h3 className="builder-inspector__title">{selectedField.label}</h3>
              </div>

              <div className="builder-inspector__section">
                <label className="builder-inspector__field">
                  <span>{'\u041d\u0430\u0437\u0432\u0430\u043d\u0438\u0435'}</span>
                  <input
                    value={selectedField.label}
                    maxLength={MAX_FIELD_LABEL_LENGTH}
                    onChange={(event) =>
                      updateField(selectedField.id, { label: event.target.value })
                    }
                  />
                  <span className="builder-inspector__field-hint">
                    {selectedField.label.length}/{MAX_FIELD_LABEL_LENGTH} {'симв.'}
                  </span>
                </label>

                <label className="builder-inspector__field builder-inspector__field_hidden">
                  <span>{'\u041a\u043b\u044e\u0447'}</span>
                  <input
                    type="hidden"
                    value={selectedField.key}
                    onChange={(event) => updateField(selectedField.id, { key: event.target.value })}
                  />
                </label>

                <label className="builder-inspector__field">
                  <span>{'\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435'}</span>
                  <input
                    value={selectedField.description ?? ''}
                    maxLength={MAX_FIELD_DESCRIPTION_LENGTH}
                    onChange={(event) =>
                      updateField(selectedField.id, { description: event.target.value })
                    }
                  />
                  <span className="builder-inspector__field-hint">
                    {(selectedField.description ?? '').length}/{MAX_FIELD_DESCRIPTION_LENGTH} {'симв.'}
                  </span>
                </label>

                <label className="builder-inspector__checkbox">
                  <input
                    type="checkbox"
                    checked={selectedField.hidden === true}
                    onChange={(event) =>
                      updateField(selectedField.id, { hidden: event.target.checked })
                    }
                  />
                  <span>{'Скрыть блок'}</span>
                </label>

                <div className="builder-inspector__spacing">
                  <label className="builder-inspector__spacing-toggle">
                    <span className="builder-inspector__spacing-title">{'\u041e\u0442\u0441\u0442\u0443\u043f\u044b \u0431\u043b\u043e\u043a\u0430'}</span>
                    <input
                      type="checkbox"
                      checked={isSpacingOpen}
                      onChange={(event) => setIsSpacingOpen(event.target.checked)}
                    />
                  </label>
                  {isSpacingOpen ? (
                    <>
                      <div className="builder-inspector__spacing-title">{'\u0417\u043d\u0430\u0447\u0435\u043d\u0438\u044f \u043e\u0442\u0441\u0442\u0443\u043f\u043e\u0432'}</div>
                      <div className="builder-inspector__grid builder-inspector__grid_compact">
                        <label className="builder-inspector__field builder-inspector__field_compact">
                          <span>{'\u0421\u0432\u0435\u0440\u0445\u0443'}</span>
                          <input
                            type="number"
                            min="0"
                            max={MAX_FIELD_MARGIN}
                            value={selectedField.marginTop ?? 0}
                            onChange={(event) =>
                              updateField(selectedField.id, { marginTop: Number(event.target.value) || 0 })
                            }
                          />
                        </label>

                        <label className="builder-inspector__field builder-inspector__field_compact">
                          <span>{'\u0421\u043d\u0438\u0437\u0443'}</span>
                          <input
                            type="number"
                            min="0"
                            max={MAX_FIELD_MARGIN}
                            value={selectedField.marginBottom ?? 0}
                            onChange={(event) =>
                              updateField(selectedField.id, { marginBottom: Number(event.target.value) || 0 })
                            }
                          />
                        </label>

                        <label className="builder-inspector__field builder-inspector__field_compact">
                          <span>{'\u0421\u043b\u0435\u0432\u0430'}</span>
                          <input
                            type="number"
                            min="0"
                            max={MAX_FIELD_MARGIN}
                            value={selectedField.marginLeft ?? 0}
                            onChange={(event) =>
                              updateField(selectedField.id, { marginLeft: Number(event.target.value) || 0 })
                            }
                          />
                        </label>

                        <label className="builder-inspector__field builder-inspector__field_compact">
                          <span>{'\u0421\u043f\u0440\u0430\u0432\u0430'}</span>
                          <input
                            type="number"
                            min="0"
                            max={MAX_FIELD_MARGIN}
                            value={selectedField.marginRight ?? 0}
                            onChange={(event) =>
                              updateField(selectedField.id, { marginRight: Number(event.target.value) || 0 })
                            }
                          />
                        </label>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="builder-inspector__section">
                {selectedField.type === 'select' || selectedField.type === 'radio' ? (
                  <>
                    <label className="builder-inspector__field">
                      <span>{'\u041f\u043e\u0434\u0441\u043a\u0430\u0437\u043a\u0430'}</span>
                      <input
                        value={selectedField.placeholder ?? ''}
                        maxLength={MAX_FIELD_PLACEHOLDER_LENGTH}
                        onChange={(event) =>
                          updateField(selectedField.id, { placeholder: event.target.value })
                        }
                      />
                      <span className="builder-inspector__field-hint">
                        {(selectedField.placeholder ?? '').length}/{MAX_FIELD_PLACEHOLDER_LENGTH} {'симв.'}
                      </span>
                    </label>

                    <label className="builder-inspector__field">
                      <span>{'\u0417\u043d\u0430\u0447\u0435\u043d\u0438\u0435 \u043f\u043e \u0443\u043c\u043e\u043b\u0447\u0430\u043d\u0438\u044e'}</span>
                      <select
                        value={String(selectedField.defaultValue ?? '')}
                        onChange={(event) =>
                          updateField(selectedField.id, {
                            defaultValue:
                              selectedField.options?.find(
                                (option) => String(option.value) === event.target.value,
                              )?.value ?? '',
                          })
                        }
                      >
                        <option value="">{'\u041d\u0435 \u0432\u044b\u0431\u0440\u0430\u043d\u043e'}</option>
                        {(selectedField.options ?? []).map((option) => (
                          <option key={option.id} value={String(option.value)}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="builder-inspector__field">
                      <span>{'\u0421\u043f\u0438\u0441\u043e\u043a \u0432\u0430\u0440\u0438\u0430\u043d\u0442\u043e\u0432'}</span>
                      <div className="builder-option-list">
                        {(selectedField.options ?? []).map((option) => (
                          <div key={option.id} className="builder-option-row">
                            <input
                              value={option.label}
                              placeholder={'\u041d\u0430\u0437\u0432\u0430\u043d\u0438\u0435'}
                              maxLength={MAX_OPTION_LABEL_LENGTH}
                              onChange={(event) =>
                                updateSelectOption(selectedField.id, option.id, {
                                  label: event.target.value,
                                })
                              }
                            />
                            <input
                              type="number"
                              value={option.value}
                              placeholder={'\u0417\u043d\u0430\u0447\u0435\u043d\u0438\u0435'}
                              onChange={(event) =>
                                updateSelectOption(selectedField.id, option.id, {
                                  value: Number(event.target.value) || 0,
                                })
                              }
                            />
                            <input
                              value={option.description ?? ''}
                              placeholder={'\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435'}
                              maxLength={MAX_OPTION_DESCRIPTION_LENGTH}
                              disabled={!canUseProFeatures}
                              onChange={(event) =>
                                updateSelectOption(selectedField.id, option.id, {
                                  description: event.target.value,
                                })
                              }
                            />
                            <button
                              className="builder-option-row__remove"
                              type="button"
                              onClick={() =>
                                setPendingDeleteOption({
                                  fieldId: selectedField.id,
                                  optionId: option.id,
                                  label: option.label,
                                })
                              }
                            >
                              {'\u0423\u0434\u0430\u043b\u0438\u0442\u044c'}
                            </button>
                          </div>
                        ))}
                        <button
                          className="builder-option-list__add"
                          type="button"
                          onClick={() => addSelectOption(selectedField.id)}
                        >
                          {'\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0432\u0430\u0440\u0438\u0430\u043d\u0442'}
                        </button>
                      </div>
                    </div>

                    {selectedField.type === 'radio' ? (
                      <>
                        <label className="builder-inspector__field">
                          <span>{'\u041e\u0442\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435 \u0432\u0430\u0440\u0438\u0430\u043d\u0442\u043e\u0432'}</span>
                          <select
                            value={selectedField.optionLayout ?? 'vertical'}
                            onChange={(event) =>
                              updateField(selectedField.id, {
                                optionLayout: event.target.value as CalculatorField['optionLayout'],
                              })
                            }
                          >
                            <option value="vertical">{'\u0412\u0435\u0440\u0442\u0438\u043a\u0430\u043b\u044c\u043d\u043e'}</option>
                            <option value="horizontal">{'\u0413\u043e\u0440\u0438\u0437\u043e\u043d\u0442\u0430\u043b\u044c\u043d\u043e'}</option>
                          </select>
                        </label>

	                        <label className="builder-inspector__checkbox">
	                          <input
	                            type="checkbox"
	                            checked={Boolean(selectedField.showOptionDescription)}
	                            disabled={!canUseProFeatures}
	                            onChange={(event) =>
	                              updateField(selectedField.id, {
	                                showOptionDescription: event.target.checked,
                              })
                            }
                          />
                          <span>{'\u041f\u043e\u043a\u0430\u0437\u044b\u0432\u0430\u0442\u044c \u043e\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u0443 \u0432\u0430\u0440\u0438\u0430\u043d\u0442\u0430'}</span>
                        </label>

	                        <label className="builder-inspector__checkbox">
	                          <input
	                            type="checkbox"
	                            checked={Boolean(selectedField.showOptionPrice)}
	                            disabled={!canUseProFeatures}
	                            onChange={(event) =>
	                              updateField(selectedField.id, {
	                                showOptionPrice: event.target.checked,
                              })
                            }
                          />
                          <span>{'\u041f\u043e\u043a\u0430\u0437\u044b\u0432\u0430\u0442\u044c \u0446\u0435\u043d\u0443 \u0443 \u0432\u0430\u0440\u0438\u0430\u043d\u0442\u0430'}</span>
                        </label>
                      </>
                    ) : (
	                      <label className="builder-inspector__checkbox">
	                        <input
	                          type="checkbox"
	                          checked={Boolean(selectedField.showOptionPrices)}
	                          disabled={!canUseProFeatures}
	                          onChange={(event) =>
	                            updateField(selectedField.id, {
	                              showOptionPrices: event.target.checked,
                            })
                          }
                        />
                        <span>{'\u041f\u043e\u043a\u0430\u0437\u044b\u0432\u0430\u0442\u044c \u0446\u0435\u043d\u0443 \u0440\u044f\u0434\u043e\u043c \u0441 \u0432\u0430\u0440\u0438\u0430\u043d\u0442\u043e\u043c'}</span>
                      </label>
	                    )}
                    {!canUseProFeatures ? (
                      <div className="builder-inspector__field-hint">
                        {proFeatureHint('Описания и показ цены у вариантов доступны на тарифе Про.')}
                      </div>
                    ) : null}

                    <label className="builder-inspector__checkbox">
                      <input
                        type="checkbox"
                        checked={selectedField.useValueInFormula !== false}
                        onChange={(event) =>
                          updateField(selectedField.id, {
                            useValueInFormula: event.target.checked,
                          })
                        }
                      />
                      <span>{'\u0418\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u044c \u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0435 \u0432 \u0444\u043e\u0440\u043c\u0443\u043b\u0435'}</span>
                    </label>
                  </>
                ) : selectedField.type === 'booking' ? (
                  <>
                    <label className="builder-inspector__field">
                      <span>{'\u041f\u043e\u0434\u0441\u043a\u0430\u0437\u043a\u0430'}</span>
                      <input
                        value={selectedField.placeholder ?? ''}
                        maxLength={MAX_FIELD_PLACEHOLDER_LENGTH}
                        onChange={(event) =>
                          updateField(selectedField.id, { placeholder: event.target.value })
                        }
                      />
                      <span className="builder-inspector__field-hint">
                        {(selectedField.placeholder ?? '').length}/{MAX_FIELD_PLACEHOLDER_LENGTH} {'симв.'}
                      </span>
                    </label>

                    <label className="builder-inspector__field">
                      <span>{'\u041f\u043e\u0434\u0441\u043a\u0430\u0437\u043a\u0430 \u043f\u043e\u0434 \u043f\u043e\u043b\u0435\u043c'}</span>
                      <input
                        value={selectedField.hint ?? ''}
                        maxLength={MAX_FIELD_HINT_LENGTH}
                        onChange={(event) => updateField(selectedField.id, { hint: event.target.value })}
                      />
                      <span className="builder-inspector__field-hint">
                        {(selectedField.hint ?? '').length}/{MAX_FIELD_HINT_LENGTH} {'симв.'}
                      </span>
                    </label>

                    <label className="builder-inspector__field">
                      <span>{'\u0414\u043e\u0441\u0442\u0443\u043f\u043d\u044b\u0435 \u0434\u043d\u0438 \u043d\u0435\u0434\u0435\u043b\u0438'}</span>
                      <input
                        value={(selectedField.bookingWeekdays ?? [1, 2, 3, 4, 5]).join(',')}
                        placeholder="1,2,3,4,5"
                        onChange={(event) =>
                          updateField(selectedField.id, {
                            bookingWeekdays: event.target.value
                              .split(',')
                              .map((item) => Number(item.trim()))
                              .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6),
                          })
                        }
                      />
                    </label>

                    <div className="builder-inspector__grid">
                      <label className="builder-inspector__field">
                        <span>{'\u041d\u0430\u0447\u0430\u043b\u043e \u0440\u0430\u0431\u043e\u0442\u044b'}</span>
                        <LocalizedBuilderDateTimeInput
                          type="time"
                          value={selectedField.bookingStartTime ?? '09:00'}
                          placeholder="чч:мм"
                          onChange={(nextValue) =>
                            updateField(selectedField.id, { bookingStartTime: nextValue })
                          }
                        />
                      </label>

                      <label className="builder-inspector__field">
                        <span>{'\u041a\u043e\u043d\u0435\u0446 \u0440\u0430\u0431\u043e\u0442\u044b'}</span>
                        <LocalizedBuilderDateTimeInput
                          type="time"
                          value={selectedField.bookingEndTime ?? '18:00'}
                          placeholder="чч:мм"
                          onChange={(nextValue) =>
                            updateField(selectedField.id, { bookingEndTime: nextValue })
                          }
                        />
                      </label>
                    </div>

                    <label className="builder-inspector__field">
                      <span>{'\u0418\u0441\u043a\u043b\u044e\u0447\u0451\u043d\u043d\u044b\u0435 \u0434\u0430\u0442\u044b'}</span>
                      <input
                        value={(selectedField.bookingExcludedDates ?? []).join(',')}
                        placeholder="2026-06-10,2026-06-12"
                        onChange={(event) =>
                          updateField(selectedField.id, {
                            bookingExcludedDates: event.target.value
                              .split(',')
                              .map((item) => item.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                    </label>

                    <div className="builder-inspector__grid">
                      <label className="builder-inspector__field">
                        <span>{'\u041c\u0438\u043d. \u0434\u0430\u0442\u0430'}</span>
                        <LocalizedBuilderDateTimeInput
                          type="date"
                          value={selectedField.bookingMinDate ?? ''}
                          placeholder="дд.мм.гггг"
                          onChange={(nextValue) =>
                            updateField(selectedField.id, { bookingMinDate: nextValue })
                          }
                        />
                      </label>

                      <label className="builder-inspector__field">
                        <span>{'\u041c\u0430\u043a\u0441. \u0434\u0430\u0442\u0430'}</span>
                        <LocalizedBuilderDateTimeInput
                          type="date"
                          value={selectedField.bookingMaxDate ?? ''}
                          placeholder="дд.мм.гггг"
                          onChange={(nextValue) =>
                            updateField(selectedField.id, { bookingMaxDate: nextValue })
                          }
                        />
                      </label>
                    </div>

                    <div className="builder-inspector__grid">
                      <label className="builder-inspector__field">
                        <span>{'\u0417\u0430\u044f\u0432\u043e\u043a \u043d\u0430 \u0441\u043b\u043e\u0442'}</span>
                        <input
                          type="number"
                          min="1"
                          value={selectedField.bookingMaxRequestsPerSlot ?? 1}
                          onChange={(event) =>
                            updateField(selectedField.id, {
                              bookingMaxRequestsPerSlot: Number(event.target.value) || 1,
                            })
                          }
                        />
                      </label>

                      <label className="builder-inspector__field">
                        <span>{'\u0414\u043e\u043f\u043b\u0430\u0442\u0430 \u0437\u0430 \u0441\u0440\u043e\u0447\u043d\u043e\u0441\u0442\u044c'}</span>
                        <input
                          type="number"
                          min="0"
                          value={selectedField.bookingUrgentSurcharge ?? 0}
                          onChange={(event) =>
                            updateField(selectedField.id, {
                              bookingUrgentSurcharge: Number(event.target.value) || 0,
                            })
                          }
                        />
                      </label>
                    </div>

                    <label className="builder-inspector__field">
                      <span>{'\u0421\u0447\u0438\u0442\u0430\u0442\u044c \u0441\u0440\u043e\u0447\u043d\u044b\u043c \u0437\u0430, \u0447\u0430\u0441\u043e\u0432 \u0434\u043e \u0437\u0430\u043f\u0438\u0441\u0438'}</span>
                      <input
                        type="number"
                        min="1"
                        value={selectedField.bookingUrgentThresholdHours ?? 24}
                        onChange={(event) =>
                          updateField(selectedField.id, {
                            bookingUrgentThresholdHours: Number(event.target.value) || 24,
                          })
                        }
                      />
                    </label>
                  </>
                ) : selectedField.type === 'slider' ? (
                  <>
                    <label className="builder-inspector__field">
                      <span>{'\u041f\u043e\u0434\u0441\u043a\u0430\u0437\u043a\u0430'}</span>
                      <input
                        value={selectedField.placeholder ?? ''}
                        maxLength={MAX_FIELD_PLACEHOLDER_LENGTH}
                        onChange={(event) =>
                          updateField(selectedField.id, { placeholder: event.target.value })
                        }
                      />
                      <span className="builder-inspector__field-hint">
                        {(selectedField.placeholder ?? '').length}/{MAX_FIELD_PLACEHOLDER_LENGTH} {'симв.'}
                      </span>
                    </label>

                    <div className="builder-inspector__grid">
                      <label className="builder-inspector__field">
                        <span>{'\u041c\u0438\u043d\u0438\u043c\u0443\u043c'}</span>
                        <input
                          type="number"
                          value={selectedField.min ?? ''}
                          onChange={(event) =>
                            updateField(selectedField.id, {
                              min: event.target.value === '' ? undefined : Number(event.target.value),
                            })
                          }
                        />
                      </label>

                      <label className="builder-inspector__field">
                        <span>{'\u041c\u0430\u043a\u0441\u0438\u043c\u0443\u043c'}</span>
                        <input
                          type="number"
                          value={selectedField.max ?? ''}
                          onChange={(event) =>
                            updateField(selectedField.id, {
                              max: event.target.value === '' ? undefined : Number(event.target.value),
                            })
                          }
                        />
                      </label>

                      <label className="builder-inspector__field">
                        <span>{'\u0428\u0430\u0433'}</span>
                        <input
                          type="number"
                          value={selectedField.step ?? 1}
                          onChange={(event) =>
                            updateField(selectedField.id, {
                              step: Number(event.target.value) || 1,
                            })
                          }
                        />
                      </label>

                      <label className="builder-inspector__field">
                        <span>{'\u0417\u043d\u0430\u0447\u0435\u043d\u0438\u0435 \u043f\u043e \u0443\u043c\u043e\u043b\u0447\u0430\u043d\u0438\u044e'}</span>
                        <input
                          type="number"
                          value={Number(selectedField.defaultValue ?? selectedField.min ?? 0)}
                          onChange={(event) =>
                            updateField(selectedField.id, {
                              defaultValue: Number(event.target.value) || 0,
                            })
                          }
                        />
                      </label>
                    </div>

                    <label className="builder-inspector__field">
                      <span>{'\u0415\u0434\u0438\u043d\u0438\u0446\u0430 \u0438\u0437\u043c\u0435\u0440\u0435\u043d\u0438\u044f'}</span>
                      <select
                        value={selectedField.unit ?? '\u0448\u0442'}
                        onChange={(event) =>
                          updateField(selectedField.id, {
                            unit: event.target.value as CalculatorField['unit'],
                          })
                        }
                      >
                        <option value={'\u20bd'}>{'\u20bd'}</option>
                        <option value={'\u043c\u00b2'}>{'\u043c\u00b2'}</option>
                        <option value={'\u0448\u0442'}>{'\u0448\u0442'}</option>
                        <option value={'\u0434\u043d\u0435\u0439'}>{'\u0434\u043d\u0435\u0439'}</option>
                        <option value={'\u0447\u0430\u0441\u043e\u0432'}>{'\u0447\u0430\u0441\u043e\u0432'}</option>
                      </select>
                    </label>

                    <label className="builder-inspector__checkbox">
                      <input
                        type="checkbox"
                        checked={selectedField.showCurrentValue !== false}
                        onChange={(event) =>
                          updateField(selectedField.id, {
                            showCurrentValue: event.target.checked,
                          })
                        }
                      />
                      <span>{'\u041f\u043e\u043a\u0430\u0437\u044b\u0432\u0430\u0442\u044c \u0442\u0435\u043a\u0443\u0449\u0435\u0435 \u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0435'}</span>
                    </label>

                    <label className="builder-inspector__checkbox">
                      <input
                        type="checkbox"
                        checked={selectedField.showScale !== false}
                        onChange={(event) =>
                          updateField(selectedField.id, {
                            showScale: event.target.checked,
                          })
                        }
                      />
                      <span>{'\u041f\u043e\u043a\u0430\u0437\u044b\u0432\u0430\u0442\u044c \u0448\u043a\u0430\u043b\u0443'}</span>
                    </label>

                    <label className="builder-inspector__checkbox">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedField.hideScaleNumbers)}
                        onChange={(event) =>
                          updateField(selectedField.id, {
                            hideScaleNumbers: event.target.checked,
                          })
                        }
                      />
                      <span>{'\u0421\u043a\u0440\u044b\u0432\u0430\u0442\u044c \u0447\u0438\u0441\u043b\u0430 \u043d\u0430 \u0448\u043a\u0430\u043b\u0435'}</span>
                    </label>

                    <label className="builder-inspector__checkbox">
                      <input
                        type="checkbox"
                        checked={selectedField.allowManualInput !== false}
                        onChange={(event) =>
                          updateField(selectedField.id, {
                            allowManualInput: event.target.checked,
                          })
                        }
                      />
                      <span>{'\u0420\u0430\u0437\u0440\u0435\u0448\u0438\u0442\u044c \u0440\u0443\u0447\u043d\u043e\u0439 \u0432\u0432\u043e\u0434 \u0440\u044f\u0434\u043e\u043c \u0441 \u043f\u043e\u043b\u0437\u0443\u043d\u043a\u043e\u043c'}</span>
                    </label>

                    <label className="builder-inspector__checkbox">
                      <input
                        type="checkbox"
                        checked={selectedField.useValueInFormula !== false}
                        onChange={(event) =>
                          updateField(selectedField.id, {
                            useValueInFormula: event.target.checked,
                          })
                        }
                      />
                      <span>{'\u0418\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u044c \u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0435 \u0432 \u0444\u043e\u0440\u043c\u0443\u043b\u0435'}</span>
                    </label>
                  </>
                ) : selectedField.type === 'checkbox' ? (
                  <>
                    <label className="builder-inspector__field">
                      <span>{'\u041f\u043e\u0434\u0441\u043a\u0430\u0437\u043a\u0430'}</span>
                      <input
                        value={selectedField.placeholder ?? ''}
                        maxLength={MAX_FIELD_PLACEHOLDER_LENGTH}
                        onChange={(event) =>
                          updateField(selectedField.id, { placeholder: event.target.value })
                        }
                      />
                      <span className="builder-inspector__field-hint">
                        {(selectedField.placeholder ?? '').length}/{MAX_FIELD_PLACEHOLDER_LENGTH} {'симв.'}
                      </span>
                    </label>

                    <label className="builder-inspector__field">
                      <span>{'\u0422\u0435\u043a\u0441\u0442 \u043e\u0441\u043d\u043e\u0432\u043d\u043e\u0439 \u0441\u0442\u0440\u043e\u043a\u0438'}</span>
                      <input
                        value={selectedField.checkboxLabel ?? ''}
                        maxLength={MAX_CHECKBOX_LABEL_LENGTH}
                        onChange={(event) =>
                          updateField(selectedField.id, { checkboxLabel: event.target.value })
                        }
                      />
                      <span className="builder-inspector__field-hint">
                        {(selectedField.checkboxLabel ?? '').length}/{MAX_CHECKBOX_LABEL_LENGTH} {'симв.'}
                      </span>
                    </label>

                    <div className="builder-inspector__grid">
                      <label className="builder-inspector__field">
                        <span>{'\u0417\u043d\u0430\u0447\u0435\u043d\u0438\u0435 \u043e\u0441\u043d\u043e\u0432\u043d\u043e\u0439 \u0441\u0442\u0440\u043e\u043a\u0438'}</span>
                        <input
                          type="number"
                          value={Number(selectedField.onValue ?? 0)}
                          onChange={(event) =>
                            updateField(selectedField.id, { onValue: Number(event.target.value) || 0 })
                          }
                        />
                      </label>

                      <label className="builder-inspector__field">
                        <span>{'\u0417\u043d\u0430\u0447\u0435\u043d\u0438\u0435 \u043f\u0440\u0438 \u0432\u044b\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0438'}</span>
                        <input
                          type="number"
                          value={Number(selectedField.offValue ?? 0)}
                          onChange={(event) =>
                            updateField(selectedField.id, { offValue: Number(event.target.value) || 0 })
                          }
                        />
                      </label>
                    </div>

                    <div className="builder-inspector__field">
                      <span>{'\u0414\u043e\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u043d\u044b\u0435 \u0441\u0442\u0440\u043e\u043a\u0438'}</span>
                      <div className="builder-option-list">
                        {(selectedField.options ?? []).map((option) => (
                          <div
                            key={option.id}
                            className={`builder-option-row ${draggedOptionId === option.id ? 'builder-option-row_dragging' : ''} ${dragOverOptionId === option.id ? 'builder-option-row_drop-target' : ''}`}
                            draggable
                            onDragStart={() => startOptionDrag(option.id)}
                            onDragOver={(event) => handleOptionDragOver(event, option.id)}
                            onDragEnd={finishOptionDrag}
                            onDrop={(event) => {
                              event.preventDefault();
                              if (draggedOptionId) {
                                moveSelectOption(selectedField.id, draggedOptionId, option.id);
                              }
                              finishOptionDrag();
                            }}
                          >
                            <div className="builder-option-row__tools">
                              <label className="builder-option-row__default">
                                <input
                                  type="checkbox"
                                  checked={
                                    Array.isArray(selectedField.defaultValue) &&
                                    selectedField.defaultValue.includes(option.id)
                                  }
                                  onChange={(event) =>
                                    toggleCheckboxDefaultOption(selectedField, option.id, event.target.checked)
                                  }
                                />
                                <span>{'\u041f\u043e \u0443\u043c\u043e\u043b\u0447\u0430\u043d\u0438\u044e'}</span>
                              </label>
                            </div>
                            <input
                              className="builder-option-row__label-input"
                              value={option.label}
                              placeholder={'\u0422\u0435\u043a\u0441\u0442 \u0441\u0442\u0440\u043e\u043a\u0438'}
                              maxLength={MAX_OPTION_LABEL_LENGTH}
                              onChange={(event) =>
                                updateSelectOption(selectedField.id, option.id, {
                                  label: event.target.value,
                                })
                              }
                            />
                            <input
                              className="builder-option-row__value-input"
                              type="number"
                              value={option.value}
                              placeholder={'\u0417\u043d\u0430\u0447\u0435\u043d\u0438\u0435'}
                              onChange={(event) =>
                                updateSelectOption(selectedField.id, option.id, {
                                  value: Number(event.target.value) || 0,
                                })
                              }
                            />
                            <input
                              className="builder-option-row__meta-input"
                              value={option.description ?? ''}
                              placeholder={'\u041f\u043e\u0434\u043f\u0438\u0441\u044c'}
                              maxLength={MAX_OPTION_DESCRIPTION_LENGTH}
                              disabled={!canUseProFeatures}
                              onChange={(event) =>
                                updateSelectOption(selectedField.id, option.id, {
                                  description: event.target.value,
                                })
                              }
                            />
                            <button
                              className="builder-option-row__remove"
                              type="button"
                              onClick={() =>
                                setPendingDeleteOption({
                                  fieldId: selectedField.id,
                                  optionId: option.id,
                                  label: option.label,
                                })
                              }
                            >
                              {'\u0423\u0434\u0430\u043b\u0438\u0442\u044c'}
                            </button>
                          </div>
                        ))}
                        <button
                          className="builder-option-list__add"
                          type="button"
                          disabled={!canUseProFeatures}
                          onClick={() => addSelectOption(selectedField.id)}
                        >
                          {'\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0441\u0442\u0440\u043e\u043a\u0443'}
                        </button>
                      </div>
                    </div>
                    {!canUseProFeatures ? (
                      <div className="builder-inspector__field-hint">
                        {proFeatureHint('Дополнительные строки чекбокса доступны на тарифе Про.')}
                      </div>
                    ) : null}

                    <label className="builder-inspector__checkbox">
                      <input
                        type="checkbox"
                        checked={
                          Array.isArray(selectedField.defaultValue)
                            ? selectedField.defaultValue.includes('__primary__')
                            : Boolean(selectedField.defaultValue)
                        }
                        onChange={(event) =>
                          toggleCheckboxPrimaryDefault(selectedField, event.target.checked)
                        }
                      />
                      <span>{'\u041e\u0441\u043d\u043e\u0432\u043d\u0430\u044f \u0441\u0442\u0440\u043e\u043a\u0430 \u0432\u043a\u043b\u044e\u0447\u0435\u043d\u0430 \u043f\u043e \u0443\u043c\u043e\u043b\u0447\u0430\u043d\u0438\u044e'}</span>
                    </label>

                    <label className="builder-inspector__checkbox">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedField.showPriceInline)}
                        onChange={(event) =>
                          updateField(selectedField.id, { showPriceInline: event.target.checked })
                        }
                      />
                      <span>{'\u041f\u043e\u043a\u0430\u0437\u044b\u0432\u0430\u0442\u044c \u0446\u0435\u043d\u0443 \u0440\u044f\u0434\u043e\u043c \u0441 \u0442\u0435\u043a\u0441\u0442\u043e\u043c'}</span>
                    </label>

                    <label className="builder-inspector__checkbox">
                      <input
                        type="checkbox"
                        checked={selectedField.useValueInFormula !== false}
                        onChange={(event) =>
                          updateField(selectedField.id, {
                            useValueInFormula: event.target.checked,
                          })
                        }
                      />
                      <span>{'\u0418\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u044c \u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0435 \u0432 \u0444\u043e\u0440\u043c\u0443\u043b\u0435'}</span>
                    </label>
                  </>
                ) : selectedField.type === 'html' ? (
                  <>
                    <label className="builder-inspector__field">
                      <span>{'HTML-код'}</span>
                      <textarea
                        value={selectedField.htmlContent ?? ''}
                        placeholder="<div><strong>Контент</strong></div>"
                        onChange={(event) =>
                          updateField(selectedField.id, { htmlContent: event.target.value })
                        }
                      />
                    </label>

                    <div className="builder-inspector__field">
                      <span>{'Предпросмотр'}</span>
                      <div
                        className="builder-html-preview"
                        dangerouslySetInnerHTML={{
                          __html: sanitizeHtml(selectedField.htmlContent ?? ''),
                        }}
                      />
                    </div>

                    <div className="builder-inspector__field-hint">
                      Разрешены только: div, span, p, b, strong, i, ul, li, br, a.
                    </div>
                  </>
                ) : selectedField.type === 'image' ? (
                  <>
                    <div className="builder-inspector__field">
                      <span>{'\u041a\u0430\u0440\u0442\u0438\u043d\u043a\u0430'}</span>
                      <label className="builder-upload-field">
                        <input
                          className="builder-upload-field__input"
                          type="file"
                          accept="image/*"
                          onChange={(event) => handleImageUpload(selectedField.id, event.target.files?.[0])}
                        />
                        <span className="builder-upload-field__button">{'\u0412\u044b\u0431\u0440\u0430\u0442\u044c \u043a\u0430\u0440\u0442\u0438\u043d\u043a\u0443'}</span>
                      </label>
                      <div className="builder-inspector__field-hint">
                        Рекомендуемый размер: 1600 x 900 px, формат 16:9.
                      </div>
                    </div>

                    <label className="builder-inspector__field">
                      <span>{'\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u043a\u0430\u0440\u0442\u0438\u043d\u043a\u0438'}</span>
                      <input
                        value={selectedField.imageAlt ?? ''}
                        onChange={(event) =>
                          updateField(selectedField.id, { imageAlt: event.target.value })
                        }
                      />
                    </label>

                    <label className="builder-inspector__field">
                      <span>{'\u041f\u043e\u0434\u043f\u0438\u0441\u044c'}</span>
                      <input
                        value={selectedField.imageCaption ?? ''}
                        onChange={(event) =>
                          updateField(selectedField.id, { imageCaption: event.target.value })
                        }
                      />
                    </label>

                    <div className="builder-inspector__grid">
                      <label className="builder-inspector__field">
                        <span>{'\u0420\u0430\u0437\u043c\u0435\u0440'}</span>
                        <select
                          value={selectedField.imageSize ?? 'large'}
                          onChange={(event) =>
                            updateField(selectedField.id, {
                              imageSize: event.target.value as CalculatorField['imageSize'],
                            })
                          }
                        >
                          <option value="small">{'\u041c\u0430\u043b\u0435\u043d\u044c\u043a\u0438\u0439'}</option>
                          <option value="medium">{'\u0421\u0440\u0435\u0434\u043d\u0438\u0439'}</option>
                          <option value="large">{'\u0411\u043e\u043b\u044c\u0448\u043e\u0439'}</option>
                          <option value="full">{'\u041d\u0430 \u0432\u0441\u044e \u0448\u0438\u0440\u0438\u043d\u0443'}</option>
                        </select>
                      </label>

                      <label className="builder-inspector__field">
                        <span>{'\u0421\u043a\u0440\u0443\u0433\u043b\u0435\u043d\u0438\u0435 \u0443\u0433\u043b\u043e\u0432'}</span>
                        <input
                          type="number"
                          min="0"
                          max="40"
                          value={selectedField.imageRadius ?? 24}
                          onChange={(event) =>
                            updateField(selectedField.id, {
                              imageRadius: Math.min(40, Math.max(0, Number(event.target.value) || 0)),
                            })
                          }
                        />
                      </label>
                    </div>

                    <div className="builder-inspector__grid">
                      <label className="builder-inspector__field">
                        <span>{'\u0412\u044b\u0440\u0430\u0432\u043d\u0438\u0432\u0430\u043d\u0438\u0435'}</span>
                        <select
                          value={selectedField.imageAlign ?? 'center'}
                          onChange={(event) =>
                            updateField(selectedField.id, {
                              imageAlign: event.target.value as CalculatorField['imageAlign'],
                            })
                          }
                        >
                          <option value="left">{'\u0421\u043b\u0435\u0432\u0430'}</option>
                          <option value="center">{'\u041f\u043e \u0446\u0435\u043d\u0442\u0440\u0443'}</option>
                          <option value="right">{'\u0421\u043f\u0440\u0430\u0432\u0430'}</option>
                        </select>
                      </label>

                      <label className="builder-inspector__field">
                        <span>{'\u041a\u0430\u043a \u043f\u043e\u043a\u0430\u0437\u044b\u0432\u0430\u0442\u044c'}</span>
                        <select
                          value={selectedField.imageFit ?? 'cover'}
                          onChange={(event) =>
                            updateField(selectedField.id, {
                              imageFit: event.target.value as CalculatorField['imageFit'],
                            })
                          }
                        >
                          <option value="cover">{'\u0417\u0430\u043f\u043e\u043b\u043d\u0438\u0442\u044c \u0431\u043b\u043e\u043a'}</option>
                          <option value="contain">{'\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u0446\u0435\u043b\u0438\u043a\u043e\u043c'}</option>
                        </select>
                      </label>
                    </div>
                  </>
                ) : selectedField.type === 'button' ? (
                  <>
                    <label className="builder-inspector__field">
                      <span>{'\u0422\u0435\u043a\u0441\u0442 \u043a\u043d\u043e\u043f\u043a\u0438'}</span>
                      <input
                        value={selectedField.buttonText ?? ''}
                        maxLength={MAX_BUTTON_TEXT_LENGTH}
                        onChange={(event) =>
                          updateField(selectedField.id, {
                            buttonText: event.target.value.slice(0, MAX_BUTTON_TEXT_LENGTH),
                          })
                        }
                      />
                      <span className="builder-inspector__field-counter">
                        {(selectedField.buttonText ?? '').length}/{MAX_BUTTON_TEXT_LENGTH}
                      </span>
                    </label>

                    <label className="builder-inspector__field">
                      <span>{'\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435'}</span>
                      <select
                        value={selectedField.buttonAction ?? 'calculate'}
                        onChange={(event) =>
                          BASIC_BUTTON_ACTIONS.includes(event.target.value as ButtonActionType) ||
                          canUseProFeatures
                            ? updateField(selectedField.id, {
                                buttonAction: event.target.value as ButtonActionType,
                                buttonText:
                                  selectedField.buttonText?.trim()
                                    ? selectedField.buttonText
                                    : getButtonActionLabel(event.target.value as ButtonActionType),
                              })
                            : undefined
                        }
                      >
                        <option value="calculate">{'\u0420\u0430\u0441\u0441\u0447\u0438\u0442\u0430\u0442\u044c'}</option>
                        <option value="submit">{'\u041e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u0437\u0430\u044f\u0432\u043a\u0443'}</option>
                        <option value="reset">{'\u0421\u0431\u0440\u043e\u0441\u0438\u0442\u044c \u0444\u043e\u0440\u043c\u0443'}</option>
                        <option value="link" disabled={!canUseProFeatures}>{'\u041f\u0435\u0440\u0435\u0439\u0442\u0438 \u043f\u043e \u0441\u0441\u044b\u043b\u043a\u0435'}</option>
                        <option value="vk" disabled={!canUseProFeatures}>{'\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435 \u0432 \u0412\u041a'}</option>
                        <option value="copy" disabled={!canUseProFeatures}>{'\u0421\u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442'}</option>
                      </select>
                      {selectedField.buttonAction === 'submit' ? (
                        <span className="builder-inspector__field-hint">
                          {'\u0417\u0430\u044f\u0432\u043a\u0430 \u0431\u0443\u0434\u0435\u0442 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0430 \u043c\u0435\u043d\u0435\u0434\u0436\u0435\u0440\u0443, \u043a\u043e\u0442\u043e\u0440\u043e\u0433\u043e \u0432\u044b \u0443\u043a\u0430\u0437\u0430\u043b\u0438 \u0432 \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0430\u0445'}
                        </span>
	                      ) : null}
                      {!canUseProFeatures ? (
                        <span className="builder-inspector__field-hint">
                          {proFeatureHint(
                            'Ссылка, сообщение в VK и копирование результата доступны на тарифе Про.',
                          )}
                        </span>
                      ) : null}
                    </label>

                    {selectedField.buttonAction === 'link' || selectedField.buttonAction === 'vk' ? (
                      <label className="builder-inspector__field">
                        <span>
                          {selectedField.buttonAction === 'vk'
                            ? '\u0421\u0441\u044b\u043b\u043a\u0430 \u043d\u0430 \u0412\u041a'
                            : '\u0421\u0441\u044b\u043b\u043a\u0430'}
                        </span>
                        <input
                          value={selectedField.buttonUrl ?? ''}
                          placeholder={
                            selectedField.buttonAction === 'vk' ? 'https://vk.com/im?sel=' : 'https://'
                          }
                          onChange={(event) =>
                            updateField(selectedField.id, { buttonUrl: event.target.value })
                          }
                        />
                      </label>
                    ) : null}

                    <div className="builder-inspector__grid">
                      <label className="builder-inspector__field">
                        <span>{'\u0426\u0432\u0435\u0442'}</span>
                        <select
                          value={selectedField.buttonColor ?? 'accent'}
                          onChange={(event) =>
                            updateField(selectedField.id, {
                              buttonColor: event.target.value as CalculatorField['buttonColor'],
                            })
                          }
                        >
                          <option value="accent">{'\u041e\u0440\u0430\u043d\u0436\u0435\u0432\u0430\u044f'}</option>
                          <option value="dark">{'\u0422\u0435\u043c\u043d\u0430\u044f'}</option>
                          <option value="light">{'\u0421\u0432\u0435\u0442\u043b\u0430\u044f'}</option>
                        </select>
                      </label>

                      <label className="builder-inspector__field">
                        <span>{'\u0420\u0430\u0437\u043c\u0435\u0440'}</span>
                        <select
                          value={selectedField.buttonSize ?? 'medium'}
                          onChange={(event) =>
                            updateField(selectedField.id, {
                              buttonSize: event.target.value as CalculatorField['buttonSize'],
                            })
                          }
                        >
                          <option value="small">{'\u041c\u0430\u043b\u0435\u043d\u044c\u043a\u0430\u044f'}</option>
                          <option value="medium">{'\u0421\u0440\u0435\u0434\u043d\u044f\u044f'}</option>
                          <option value="large">{'\u0411\u043e\u043b\u044c\u0448\u0430\u044f'}</option>
                        </select>
                      </label>
                    </div>

                    <div className="builder-inspector__grid">
                      <label className="builder-inspector__field">
                        <span>{'\u0428\u0438\u0440\u0438\u043d\u0430'}</span>
                        <select
                          value={selectedField.buttonWidth ?? 'auto'}
                          onChange={(event) =>
                            updateField(selectedField.id, {
                              buttonWidth: event.target.value as CalculatorField['buttonWidth'],
                            })
                          }
                        >
                          <option value="auto">{'\u041f\u043e \u0442\u0435\u043a\u0441\u0442\u0443'}</option>
                          <option value="full">{'\u041d\u0430 \u0432\u0441\u044e \u0448\u0438\u0440\u0438\u043d\u0443'}</option>
                        </select>
                      </label>

                      <label className="builder-inspector__field">
                        <span>{'\u0421\u043a\u0440\u0443\u0433\u043b\u0435\u043d\u0438\u0435'}</span>
                        <input
                          type="number"
                          min="0"
                          max="32"
                          value={selectedField.buttonRadius ?? 18}
                          onChange={(event) =>
                            updateField(selectedField.id, {
                              buttonRadius: Math.min(32, Math.max(0, Number(event.target.value) || 0)),
                            })
                          }
                        />
                      </label>
                    </div>

                    <label className="builder-inspector__checkbox">
                      <input
                        type="checkbox"
                        checked={selectedField.buttonLoading === true}
                        onChange={(event) =>
                          updateField(selectedField.id, { buttonLoading: event.target.checked })
                        }
                      />
                      <span>{'\u041f\u043e\u043a\u0430\u0437\u044b\u0432\u0430\u0442\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0443'}</span>
                    </label>

                    <label className="builder-inspector__checkbox">
                      <input
                        type="checkbox"
                        checked={selectedField.buttonShowWhenValid === true}
                        onChange={(event) =>
                          updateField(selectedField.id, { buttonShowWhenValid: event.target.checked })
                        }
                      />
                      <span>{'\u041f\u043e\u043a\u0430\u0437\u044b\u0432\u0430\u0442\u044c \u0442\u043e\u043b\u044c\u043a\u043e \u0435\u0441\u043b\u0438 \u0444\u043e\u0440\u043c\u0430 \u0437\u0430\u043f\u043e\u043b\u043d\u0435\u043d\u0430'}</span>
                    </label>
                  </>
                ) : selectedField.type === 'result' ? (
                  <></>
                ) : selectedField.type === 'text' ? (
                  <>
                    <label className="builder-inspector__field">
                      <span>{'\u0422\u0435\u043a\u0441\u0442'}</span>
                      <textarea
                        value={selectedField.content ?? ''}
                        onChange={(event) =>
                          updateField(selectedField.id, { content: event.target.value })
                        }
                      />
                    </label>

                    <label className="builder-inspector__field">
                      <span>{'\u0422\u0438\u043f \u0442\u0435\u043a\u0441\u0442\u0430'}</span>
                      <select
                        value={selectedField.textStyle ?? 'description'}
                        onChange={(event) => {
                          const nextTextStyle = event.target.value as NonNullable<CalculatorField['textStyle']>;
                          const defaults = getTextStyleDefaults(nextTextStyle);
                          updateField(selectedField.id, {
                            textStyle: nextTextStyle,
                            fontSize: defaults.fontSize,
                            fontWeight: defaults.fontWeight,
                            textColor: defaults.textColor,
                          });
                        }}
                      >
                        <option value="title">{'\u0417\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a'}</option>
                        <option value="subtitle">{'\u041f\u043e\u0434\u0437\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a'}</option>
                        <option value="description">{'\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435'}</option>
                        <option value="hint">{'\u041f\u043e\u0434\u0441\u043a\u0430\u0437\u043a\u0430'}</option>
                      </select>
                    </label>

                    <div className="builder-inspector__grid">
                      <label className="builder-inspector__field">
                        <span>{'\u0420\u0430\u0437\u043c\u0435\u0440 \u0448\u0440\u0438\u0444\u0442\u0430'}</span>
                        <input
                          type="number"
                          min="10"
                          max="72"
                          step="1"
                          value={selectedField.fontSize ?? 16}
                          onChange={(event) =>
                            updateField(selectedField.id, {
                              fontSize: Number(event.target.value) || 16,
                            })
                          }
                          onBlur={(event) =>
                            updateField(selectedField.id, {
                              fontSize: clampTextFontSize(Number(event.target.value) || 16),
                            })
                          }
                        />
                      </label>

                      <label className="builder-inspector__field">
                        <span>{'\u0416\u0438\u0440\u043d\u043e\u0441\u0442\u044c'}</span>
                        <input
                          type="number"
                          min="30"
                          max="80"
                          step="1"
                          value={toFontWeightControlValue(selectedField.fontWeight)}
                          onChange={(event) =>
                            updateField(selectedField.id, {
                              fontWeight: (Number(event.target.value) || 40) * 10,
                            })
                          }
                          onBlur={(event) =>
                            updateField(selectedField.id, {
                              fontWeight: fromFontWeightControlValue(Number(event.target.value) || 40),
                            })
                          }
                        />
                      </label>
                    </div>

                    <div className="builder-inspector__grid">
                      <label className="builder-inspector__field">
                        <span>{'\u0426\u0432\u0435\u0442'}</span>
                        <input
                          type="color"
                          value={normalizeHexColor(
                            selectedField.textColor,
                            getTextStyleDefaults(selectedField.textStyle ?? 'description').textColor,
                          )}
                          onChange={(event) =>
                            updateField(selectedField.id, {
                              textColor: normalizeHexColor(
                                event.target.value,
                                getTextStyleDefaults(selectedField.textStyle ?? 'description').textColor,
                              ),
                            })
                          }
                        />
                      </label>

                      <label className="builder-inspector__field">
                        <span>{'\u0412\u044b\u0440\u0430\u0432\u043d\u0438\u0432\u0430\u043d\u0438\u0435'}</span>
                        <select
                          value={selectedField.textAlign ?? 'left'}
                          onChange={(event) =>
                            updateField(selectedField.id, {
                              textAlign: event.target.value as CalculatorField['textAlign'],
                            })
                          }
                        >
                          <option value="left">{'\u0421\u043b\u0435\u0432\u0430'}</option>
                          <option value="center">{'\u041f\u043e \u0446\u0435\u043d\u0442\u0440\u0443'}</option>
                          <option value="right">{'\u0421\u043f\u0440\u0430\u0432\u0430'}</option>
                        </select>
                      </label>
                    </div>

                    <label className="builder-inspector__field">
                      <span>{'\u0421\u0441\u044b\u043b\u043a\u0430'}</span>
                      <input
                        value={selectedField.linkUrl ?? ''}
                        placeholder="https://"
                        onChange={(event) =>
                          updateField(selectedField.id, { linkUrl: event.target.value })
                        }
                      />
                    </label>
                  </>
                ) : isInputField(selectedField) ? (
                  <>
                    <label className="builder-inspector__field">
                      <span>{'\u041f\u043e\u0434\u0442\u0438\u043f'}</span>
                      <select
                        value={getInputSubtype(selectedField) ?? 'text'}
                        onChange={(event) =>
                          updateField(selectedField.id, {
                            type: 'input',
                            inputSubtype: event.target.value as InputFieldSubtype,
                            defaultValue:
                              event.target.value === 'file'
                                ? undefined
                                : event.target.value === 'number'
                                  ? 0
                                  : '',
                            useValueInFormula: event.target.value === 'number',
                          })
                        }
                      >
                        <option value="text">Текст</option>
                        <option value="number">Число</option>
                        <option value="phone">Телефон</option>
                        <option value="email">Эл. почта</option>
                        <option value="date">Дата</option>
                        <option value="time">Время</option>
                        <option value="textarea">Большой текст</option>
                        <option value="file">Файл</option>
                      </select>
                    </label>

                    <label className="builder-inspector__field">
                      <span>{'Текст внутри поля'}</span>
                      <input
                        value={selectedField.placeholder ?? ''}
                        onChange={(event) => updateField(selectedField.id, { placeholder: event.target.value })}
                      />
                    </label>

                    <label className="builder-inspector__field">
                      <span>{'\u041f\u043e\u0434\u0441\u043a\u0430\u0437\u043a\u0430'}</span>
                      <input
                        value={selectedField.hint ?? ''}
                        onChange={(event) =>
                          updateField(selectedField.id, { hint: event.target.value })
                        }
                      />
                    </label>

                    <label className="builder-inspector__field">
                      <span>{'\u0417\u043d\u0430\u0447\u0435\u043d\u0438\u0435 \u043f\u043e \u0443\u043c\u043e\u043b\u0447\u0430\u043d\u0438\u044e'}</span>
                      <input
                        type={getInputSubtype(selectedField) === 'number' ? 'number' : 'text'}
                        value={
                          getInputSubtype(selectedField) === 'number'
                            ? selectedField.defaultValue === 0
                              ? ''
                              : String(selectedField.defaultValue ?? '')
                            : String(selectedField.defaultValue ?? '')
                        }
                        onChange={(event) =>
                          updateField(selectedField.id, {
                            defaultValue:
                              getInputSubtype(selectedField) === 'number'
                                ? event.target.value === ''
                                  ? ''
                                  : Number(event.target.value)
                                : event.target.value,
                          })
                        }
                      />
                    </label>

                    {getInputSubtype(selectedField) === 'number' ? (
                      <>
                        <div className="builder-inspector__grid">
                          <label className="builder-inspector__field">
                            <span>{'Минимум'}</span>
                            <input
                              type="number"
                              value={selectedField.min ?? ''}
                              onChange={(event) =>
                                updateField(selectedField.id, {
                                  min: event.target.value === '' ? undefined : Number(event.target.value),
                                })
                              }
                            />
                          </label>

                          <label className="builder-inspector__field">
                            <span>{'Максимум'}</span>
                            <input
                              type="number"
                              value={selectedField.max ?? ''}
                              onChange={(event) =>
                                updateField(selectedField.id, {
                                  max: event.target.value === '' ? undefined : Number(event.target.value),
                                })
                              }
                            />
                          </label>

                          <label className="builder-inspector__field">
                            <span>{'Шаг'}</span>
                            <input
                              type="number"
                              value={selectedField.step ?? 1}
                              onChange={(event) =>
                                updateField(selectedField.id, { step: Number(event.target.value) || 1 })
                              }
                            />
                          </label>
                        </div>

                        <label className="builder-inspector__checkbox">
                          <input
                            type="checkbox"
                            checked={selectedField.useValueInFormula !== false}
                            onChange={(event) =>
                              updateField(selectedField.id, {
                                useValueInFormula: event.target.checked,
                              })
                            }
                          />
                          <span>{'\u0418\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u044c \u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0435 \u0432 \u0444\u043e\u0440\u043c\u0443\u043b\u0435'}</span>
                        </label>
                      </>
                    ) : null}

                    {getInputSubtype(selectedField) !== 'number' &&
                    getInputSubtype(selectedField) !== 'file' &&
                    getInputSubtype(selectedField) !== 'date' &&
                    getInputSubtype(selectedField) !== 'time' ? (
                      <div className="builder-inspector__grid">
                        <label className="builder-inspector__field">
                          <span>{'\u041c\u0438\u043d. \u0434\u043b\u0438\u043d\u0430'}</span>
                          <input
                            type="number"
                            value={selectedField.minLength ?? 0}
                            onChange={(event) =>
                              updateField(selectedField.id, { minLength: Number(event.target.value) || 0 })
                            }
                          />
                        </label>

                        <label className="builder-inspector__field">
                          <span>{'\u041c\u0430\u043a\u0441. \u0434\u043b\u0438\u043d\u0430'}</span>
                          <input
                            type="number"
                            value={selectedField.maxLength ?? 0}
                            onChange={(event) =>
                              updateField(selectedField.id, { maxLength: Number(event.target.value) || 0 })
                            }
                          />
                        </label>
                      </div>
                    ) : null}

                    {getInputSubtype(selectedField) === 'phone' ? (
                      <label className="builder-inspector__checkbox">
                        <input
                          type="checkbox"
                          checked={selectedField.validatePhone !== false}
                          onChange={(event) =>
                            updateField(selectedField.id, { validatePhone: event.target.checked })
                          }
                        />
                        <span>{'\u041f\u0440\u043e\u0432\u0435\u0440\u044f\u0442\u044c \u0442\u0435\u043b\u0435\u0444\u043e\u043d'}</span>
                      </label>
                    ) : null}

                    {getInputSubtype(selectedField) === 'email' ? (
                      <label className="builder-inspector__checkbox">
                        <input
                          type="checkbox"
                          checked={selectedField.validateEmail !== false}
                          onChange={(event) =>
                            updateField(selectedField.id, { validateEmail: event.target.checked })
                          }
                        />
                        <span>{'\u041f\u0440\u043e\u0432\u0435\u0440\u044f\u0442\u044c \u044d\u043b. \u043f\u043e\u0447\u0442\u0443'}</span>
                      </label>
                    ) : null}

                    {getInputSubtype(selectedField) === 'file' ? (
                      <div className="builder-inspector__grid">
                        <label className="builder-inspector__field">
                          <span>{'\u0422\u0438\u043f\u044b \u0444\u0430\u0439\u043b\u043e\u0432'}</span>
                          <input
                            value={selectedField.fileAccept ?? ''}
                            placeholder={'.pdf,.jpg,image/*'}
                            onChange={(event) =>
                              updateField(selectedField.id, { fileAccept: event.target.value })
                            }
                          />
                        </label>

                        <label className="builder-inspector__field">
                          <span>{'\u041c\u0430\u043a\u0441. \u0440\u0430\u0437\u043c\u0435\u0440, \u041c\u0411'}</span>
                          <input
                            type="number"
                            value={selectedField.maxFileSizeMb ?? 5}
                            onChange={(event) =>
                              updateField(selectedField.id, {
                                maxFileSizeMb: Number(event.target.value) || 0,
                              })
                            }
                          />
                        </label>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <></>
                )}

                {selectedField.type !== 'text' &&
                selectedField.type !== 'image' &&
                selectedField.type !== 'button' &&
                selectedField.type !== 'result' ? (
                  <label className="builder-inspector__checkbox">
                    <input
                      type="checkbox"
                      checked={selectedField.required}
                      onChange={(event) => updateField(selectedField.id, { required: event.target.checked })}
                    />
                    <span>{'\u041e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u043d\u043e\u0435 \u043f\u043e\u043b\u0435'}</span>
                  </label>
                ) : null}

                <button
                  className="builder-inspector__danger"
                  type="button"
                  onClick={() => setPendingDeleteFieldId(selectedField.id)}
                >
                  {'\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u044d\u043b\u0435\u043c\u0435\u043d\u0442'}
                </button>
              </div>
            </>
          ) : isResultCardSelected ? (
            <>
              <div className="builder-inspector__section">
                <div className="builder-inspector__eyebrow">Инспектор</div>
                <h3 className="builder-inspector__title">Итог расчета</h3>
                <p className="builder-inspector__text">
                  Настройте показ карточки результата и подписи внутри итогового блока.
                </p>
              </div>

              <div className="builder-inspector__section">
                <label className="builder-inspector__checkbox">
                  <input
                    type="checkbox"
                    checked={template.resultCardShow !== false}
                    onChange={(event) => updateTemplate({ resultCardShow: event.target.checked })}
                  />
                  <span>Показывать карточку результата</span>
                </label>

                <label className="builder-inspector__checkbox">
                  <input
                    type="checkbox"
                    checked={template.resultCardShowTitle !== false}
                    onChange={(event) =>
                      updateTemplate({ resultCardShowTitle: event.target.checked })
                    }
                  />
                  <span>Показывать заголовок</span>
                </label>

                <label className="builder-inspector__field">
                  <span>Заголовок</span>
                  <input
                    value={template.resultCardTitle ?? 'Итог расчета'}
                    maxLength={MAX_RESULT_CARD_TITLE_LENGTH}
                    onChange={(event) =>
                      updateTemplate({
                        resultCardTitle: event.target.value.slice(0, MAX_RESULT_CARD_TITLE_LENGTH),
                      })
                    }
                  />
                  <span className="builder-inspector__field-counter">
                    {(template.resultCardTitle ?? 'Итог расчета').length}/
                    {MAX_RESULT_CARD_TITLE_LENGTH} {'симв.'}
                  </span>
                </label>

                <label className="builder-inspector__checkbox">
                  <input
                    type="checkbox"
                    checked={template.resultCardShowTotal !== false}
                    onChange={(event) =>
                      updateTemplate({ resultCardShowTotal: event.target.checked })
                    }
                  />
                  <span>Показывать итоговую сумму</span>
                </label>

                <label className="builder-inspector__checkbox">
                  <input
                    type="checkbox"
                    checked={template.resultCardShowSubtotal !== false}
                    disabled={!canUseProFeatures}
                    onChange={(event) =>
                      updateTemplate({ resultCardShowSubtotal: event.target.checked })
                    }
                  />
                  <span>Показывать подытог</span>
                </label>

                <label className="builder-inspector__field">
                  <span>Подпись подытога</span>
                  <input
                    value={template.resultSubtotalLabel ?? 'Подытог'}
                    maxLength={MAX_RESULT_CARD_LABEL_LENGTH}
                    disabled={!canUseProFeatures}
                    onChange={(event) =>
                      updateTemplate({
                        resultSubtotalLabel: event.target.value.slice(0, MAX_RESULT_CARD_LABEL_LENGTH),
                      })
                    }
                  />
                  <span className="builder-inspector__field-counter">
                    {(template.resultSubtotalLabel ?? 'Подытог').length}/
                    {MAX_RESULT_CARD_LABEL_LENGTH} {'симв.'}
                  </span>
                </label>

                <label className="builder-inspector__checkbox">
                  <input
                    type="checkbox"
                    checked={template.resultCardShowDiscount !== false}
                    disabled={!canUseProFeatures}
                    onChange={(event) =>
                      updateTemplate({ resultCardShowDiscount: event.target.checked })
                    }
                  />
                  <span>Показывать скидку</span>
                </label>

                <label className="builder-inspector__field">
                  <span>Подпись скидки</span>
                  <input
                    value={template.resultDiscountLabel ?? 'Скидка'}
                    maxLength={MAX_RESULT_CARD_LABEL_LENGTH}
                    disabled={!canUseProFeatures}
                    onChange={(event) =>
                      updateTemplate({
                        resultDiscountLabel: event.target.value.slice(0, MAX_RESULT_CARD_LABEL_LENGTH),
                      })
                    }
                  />
                  <span className="builder-inspector__field-counter">
                    {(template.resultDiscountLabel ?? 'Скидка').length}/
                    {MAX_RESULT_CARD_LABEL_LENGTH} {'симв.'}
                  </span>
                </label>

                <label className="builder-inspector__checkbox">
                  <input
                    type="checkbox"
                    checked={template.resultCardShowMinPrice !== false}
                    disabled={!canUseProFeatures}
                    onChange={(event) =>
                      updateTemplate({ resultCardShowMinPrice: event.target.checked })
                    }
                  />
                  <span>Показывать минимальную цену</span>
                </label>

                <label className="builder-inspector__field">
                  <span>Подпись минимальной цены</span>
                  <input
                    value={template.resultMinPriceLabel ?? 'Минимальная цена'}
                    maxLength={MAX_RESULT_CARD_LABEL_LENGTH}
                    disabled={!canUseProFeatures}
                    onChange={(event) =>
                      updateTemplate({
                        resultMinPriceLabel: event.target.value.slice(0, MAX_RESULT_CARD_LABEL_LENGTH),
                      })
                    }
                  />
                  <span className="builder-inspector__field-counter">
                    {(template.resultMinPriceLabel ?? 'Минимальная цена').length}/
                    {MAX_RESULT_CARD_LABEL_LENGTH} {'симв.'}
                  </span>
                </label>
                {!canUseProFeatures ? (
                  <div className="builder-inspector__field-hint">
                    {proFeatureHint('Подытог, скидка и минимальная цена доступны на тарифе Про.')}
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <div className="builder-inspector__section">
                <div className="builder-inspector__eyebrow">Инспектор</div>
                <h3 className="builder-inspector__title">Блок заявки</h3>
                <p className="builder-inspector__text">
                  Настройте тексты формы заявки или отключите ее для этого калькулятора.
                </p>
              </div>

              <div className="builder-inspector__section">
                <label className="builder-inspector__checkbox">
                  <input
                    type="checkbox"
                    checked={template.requestForm.enabled}
                    onChange={(event) =>
                      updateTemplate({
                        requestForm: {
                          ...template.requestForm,
                          enabled: event.target.checked,
                        },
                      })
                    }
                  />
                  <span>Показывать блок заявки</span>
                </label>

                <label className="builder-inspector__field">
                  <span>Заголовок</span>
                  <input
                    value={template.requestForm.title}
                    maxLength={MAX_REQUEST_FORM_TITLE_LENGTH}
                    onChange={(event) =>
                      updateTemplate({
                        requestForm: {
                          ...template.requestForm,
                          title: event.target.value.slice(0, MAX_REQUEST_FORM_TITLE_LENGTH),
                        },
                      })
                    }
                  />
                  <span className="builder-inspector__field-counter">
                    {template.requestForm.title.length}/{MAX_REQUEST_FORM_TITLE_LENGTH} {'симв.'}
                  </span>
                </label>

                <label className="builder-inspector__field">
                  <span>Описание</span>
                  <input
                    value={template.requestForm.description}
                    maxLength={MAX_REQUEST_FORM_DESCRIPTION_LENGTH}
                    onChange={(event) =>
                      updateTemplate({
                        requestForm: {
                          ...template.requestForm,
                          description: event.target.value.slice(0, MAX_REQUEST_FORM_DESCRIPTION_LENGTH),
                        },
                      })
                    }
                  />
                  <span className="builder-inspector__field-counter">
                    {template.requestForm.description.length}/{MAX_REQUEST_FORM_DESCRIPTION_LENGTH} {'симв.'}
                  </span>
                </label>

                <label className="builder-inspector__field">
                  <span>Подпись поля имени</span>
                  <input
                    value={template.requestForm.nameLabel}
                    maxLength={MAX_REQUEST_FORM_LABEL_LENGTH}
                    onChange={(event) =>
                      updateTemplate({
                        requestForm: {
                          ...template.requestForm,
                          nameLabel: event.target.value.slice(0, MAX_REQUEST_FORM_LABEL_LENGTH),
                        },
                      })
                    }
                  />
                  <span className="builder-inspector__field-counter">
                    {template.requestForm.nameLabel.length}/{MAX_REQUEST_FORM_LABEL_LENGTH} {'симв.'}
                  </span>
                </label>

                <label className="builder-inspector__field">
                  <span>Плейсхолдер имени</span>
                  <input
                    value={template.requestForm.namePlaceholder}
                    maxLength={MAX_REQUEST_FORM_PLACEHOLDER_LENGTH}
                    onChange={(event) =>
                      updateTemplate({
                        requestForm: {
                          ...template.requestForm,
                          namePlaceholder: event.target.value.slice(0, MAX_REQUEST_FORM_PLACEHOLDER_LENGTH),
                        },
                      })
                    }
                  />
                  <span className="builder-inspector__field-counter">
                    {template.requestForm.namePlaceholder.length}/{MAX_REQUEST_FORM_PLACEHOLDER_LENGTH} {'симв.'}
                  </span>
                </label>

                <label className="builder-inspector__field">
                  <span>Подпись поля телефона</span>
                  <input
                    value={template.requestForm.phoneLabel}
                    maxLength={MAX_REQUEST_FORM_LABEL_LENGTH}
                    onChange={(event) =>
                      updateTemplate({
                        requestForm: {
                          ...template.requestForm,
                          phoneLabel: event.target.value.slice(0, MAX_REQUEST_FORM_LABEL_LENGTH),
                        },
                      })
                    }
                  />
                  <span className="builder-inspector__field-counter">
                    {template.requestForm.phoneLabel.length}/{MAX_REQUEST_FORM_LABEL_LENGTH} {'симв.'}
                  </span>
                </label>

                <label className="builder-inspector__field">
                  <span>Плейсхолдер телефона</span>
                  <input
                    value={template.requestForm.phonePlaceholder}
                    maxLength={MAX_REQUEST_FORM_PLACEHOLDER_LENGTH}
                    onChange={(event) =>
                      updateTemplate({
                        requestForm: {
                          ...template.requestForm,
                          phonePlaceholder: event.target.value.slice(0, MAX_REQUEST_FORM_PLACEHOLDER_LENGTH),
                        },
                      })
                    }
                  />
                  <span className="builder-inspector__field-counter">
                    {template.requestForm.phonePlaceholder.length}/{MAX_REQUEST_FORM_PLACEHOLDER_LENGTH} {'симв.'}
                  </span>
                </label>

                <label className="builder-inspector__field">
                  <span>Подпись поля комментария</span>
                  <input
                    value={template.requestForm.commentLabel}
                    maxLength={MAX_REQUEST_FORM_LABEL_LENGTH}
                    onChange={(event) =>
                      updateTemplate({
                        requestForm: {
                          ...template.requestForm,
                          commentLabel: event.target.value.slice(0, MAX_REQUEST_FORM_LABEL_LENGTH),
                        },
                      })
                    }
                  />
                  <span className="builder-inspector__field-counter">
                    {template.requestForm.commentLabel.length}/{MAX_REQUEST_FORM_LABEL_LENGTH} {'симв.'}
                  </span>
                </label>

                <label className="builder-inspector__field">
                  <span>Плейсхолдер комментария</span>
                  <input
                    value={template.requestForm.commentPlaceholder}
                    maxLength={MAX_REQUEST_FORM_PLACEHOLDER_LENGTH}
                    onChange={(event) =>
                      updateTemplate({
                        requestForm: {
                          ...template.requestForm,
                          commentPlaceholder: event.target.value.slice(0, MAX_REQUEST_FORM_PLACEHOLDER_LENGTH),
                        },
                      })
                    }
                  />
                  <span className="builder-inspector__field-counter">
                    {template.requestForm.commentPlaceholder.length}/{MAX_REQUEST_FORM_PLACEHOLDER_LENGTH} {'симв.'}
                  </span>
                </label>

                <label className="builder-inspector__field">
                  <span>Текст кнопки</span>
                  <input
                    value={template.requestForm.submitButtonText}
                    maxLength={MAX_BUTTON_TEXT_LENGTH}
                    onChange={(event) =>
                      updateTemplate({
                        requestForm: {
                          ...template.requestForm,
                          submitButtonText: event.target.value.slice(0, MAX_BUTTON_TEXT_LENGTH),
                        },
                      })
                    }
                  />
                  <span className="builder-inspector__field-counter">
                    {template.requestForm.submitButtonText.length}/{MAX_BUTTON_TEXT_LENGTH} {'симв.'}
                  </span>
                </label>
              </div>
            </>
          )}
          </div>
        </aside>

        {isJsonModalOpen ? (
          <div className="admin-modal builder-admin-modal" role="dialog" aria-modal="true">
            <div className="admin-modal__backdrop" onClick={() => setIsJsonModalOpen(false)} />
            <div className="admin-modal__card admin-modal__card_wide builder-json-modal">
              <div className="admin-modal__eyebrow">{'JSON-хранилище'}</div>
              <h3 className="admin-modal__title">{'Проект калькулятора'}</h3>
              <p className="admin-modal__text">
                {'Здесь можно посмотреть JSON шаблона, отредактировать его и применить обратно в конструктор.'}
              </p>
              <textarea
                className="admin-modal__textarea builder-json-modal__textarea"
                value={jsonDraft}
                onChange={(event) => setJsonDraft(event.target.value)}
                spellCheck={false}
              />
              {jsonError ? <div className="admin-modal__error">{jsonError}</div> : null}
              <div className="admin-modal__actions builder-json-modal__actions">
                <button
                  className="admin-modal__button admin-modal__button_secondary"
                  type="button"
                  onClick={() => setIsJsonModalOpen(false)}
                >
                  {'Закрыть'}
                </button>
                <button
                  className="admin-modal__button admin-modal__button_secondary"
                  type="button"
                  onClick={() => void copyJsonStorage()}
                >
                  {'Копировать'}
                </button>
                <button
                  className="admin-modal__button admin-modal__button_primary"
                  type="button"
                  onClick={applyJsonStorage}
                >
                  {'Применить'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {activeLegalDoc ? (
          <div className="admin-modal builder-admin-modal" role="dialog" aria-modal="true">
            <div className="admin-modal__backdrop" onClick={() => setActiveLegalDoc(null)} />
            <div className="admin-modal__card admin-modal__card_wide calculator-legal-modal">
              <div className="admin-modal__eyebrow">{legalDocs[activeLegalDoc].caption}</div>
              <h3 className="admin-modal__title">{legalDocs[activeLegalDoc].title}</h3>
              <p className="admin-modal__text">{legalDocs[activeLegalDoc].intro}</p>
              <div className="calculator-legal-modal__sections">
                {legalDocs[activeLegalDoc].sections.map((section) => (
                  <section key={section.title} className="calculator-legal-modal__section">
                    <h4 className="calculator-legal-modal__section-title">{section.title}</h4>
                    <ul className="calculator-legal-modal__list">
                      {section.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
              <div className="admin-modal__actions">
                <button
                  className="admin-modal__button admin-modal__button_secondary"
                  type="button"
                  onClick={() => setActiveLegalDoc(null)}
                >
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {pendingDeleteFieldId ? (
          <div className="admin-modal builder-admin-modal" role="dialog" aria-modal="true">
            <div className="admin-modal__backdrop" onClick={() => setPendingDeleteFieldId(null)} />
            <div className="admin-modal__card">
              <div className='admin-modal__eyebrow'>{'\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u0435'}</div>
              <h3 className='admin-modal__title'>{'\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u044d\u043b\u0435\u043c\u0435\u043d\u0442?'}</h3>
              <p className="admin-modal__text">
                {'\u042d\u043b\u0435\u043c\u0435\u043d\u0442 \u0431\u0443\u0434\u0435\u0442 \u0443\u0434\u0430\u043b\u0435\u043d \u0438\u0437 \u043a\u0430\u043b\u044c\u043a\u0443\u043b\u044f\u0442\u043e\u0440\u0430 \u0431\u0435\u0437 \u0432\u043e\u0437\u043c\u043e\u0436\u043d\u043e\u0441\u0442\u0438 \u0432\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u044f.'}
              </p>
              <div className="admin-modal__actions">
                <button
                  className="admin-modal__button admin-modal__button_secondary"
                  type="button"
                  onClick={() => setPendingDeleteFieldId(null)}
                >
                  {'\u041e\u0442\u043c\u0435\u043d\u0430'}
                </button>
                <button
                  className="admin-modal__button admin-modal__button_danger"
                  type="button"
                  onClick={() => {
                    removeField(pendingDeleteFieldId);
                    setPendingDeleteFieldId(null);
                  }}
                >
                  {'\u0423\u0434\u0430\u043b\u0438\u0442\u044c'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {pendingDeleteOption ? (
          <div className="admin-modal builder-admin-modal" role="dialog" aria-modal="true">
            <div className="admin-modal__backdrop" onClick={() => setPendingDeleteOption(null)} />
            <div className="admin-modal__card">
              <div className='admin-modal__eyebrow'>{'\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u0435'}</div>
              <h3 className='admin-modal__title'>{'\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u0432\u0430\u0440\u0438\u0430\u043d\u0442?'}</h3>
              <p className="admin-modal__text">
                {'\u0412\u0430\u0440\u0438\u0430\u043d\u0442 '}<strong>{pendingDeleteOption.label}</strong>{' \u0431\u0443\u0434\u0435\u0442 \u0443\u0434\u0430\u043b\u0435\u043d \u0438\u0437 \u0441\u043f\u0438\u0441\u043a\u0430.'}
              </p>
              <div className="admin-modal__actions">
                <button
                  className="admin-modal__button admin-modal__button_secondary"
                  type="button"
                  onClick={() => setPendingDeleteOption(null)}
                >
                  {'\u041e\u0442\u043c\u0435\u043d\u0430'}
                </button>
                <button
                  className="admin-modal__button admin-modal__button_danger"
                  type="button"
                  onClick={() => {
                    removeSelectOption(
                      pendingDeleteOption.fieldId,
                      pendingDeleteOption.optionId,
                    );
                    setPendingDeleteOption(null);
                  }}
                >
                  {'\u0423\u0434\u0430\u043b\u0438\u0442\u044c'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
