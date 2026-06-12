import type {
  CalculationBreakdownItem,
  CalculationResult,
  CalculatorField,
  CalculatorFieldValue,
  CalculatorFieldOption,
  CalculatorRequestFormSettings,
  CalculatorTemplate,
  CalculatorValues,
} from '../../shared/types/calculator';
import { isBookingValue } from './booking';

type FormulaTemplateSource = Pick<CalculatorTemplate, 'basePrice' | 'globalCoefficient' | 'fields'>;

export const MAX_TEMPLATE_TITLE_LENGTH = 24;
export const MAX_TEMPLATE_DESCRIPTION_LENGTH = 80;
export const MAX_FOLDER_NAME_LENGTH = 20;

export const clampTemplateTitle = (value: string) =>
  value.slice(0, MAX_TEMPLATE_TITLE_LENGTH);

export const clampTemplateDescription = (value: string) =>
  value.slice(0, MAX_TEMPLATE_DESCRIPTION_LENGTH);

export const clampFolderName = (value: string) => value.slice(0, MAX_FOLDER_NAME_LENGTH);

export const createTemplatePublicId = (seed?: string) => {
  const normalizedSeed = (seed ?? crypto.randomUUID().slice(0, 8))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `calc-${normalizedSeed || crypto.randomUUID().slice(0, 8)}`;
};

export const createDefaultRequestFormSettings = (): CalculatorRequestFormSettings => ({
  enabled: true,
  title: 'РћС‚РїСЂР°РІРёС‚СЊ Р·Р°СЏРІРєСѓ',
  description: 'РћСЃС‚Р°РІСЊС‚Рµ РєРѕРЅС‚Р°РєС‚С‹, Рё РјС‹ СЃРІСЏР¶РµРјСЃСЏ СЃ РІР°РјРё',
  nameLabel: 'РРјСЏ',
  namePlaceholder: 'РљР°Рє Рє РІР°Рј РѕР±СЂР°С‰Р°С‚СЊСЃСЏ',
  phoneLabel: 'РўРµР»РµС„РѕРЅ',
  phonePlaceholder: '+7 (___) ___-__-__',
  commentLabel: 'РљРѕРјРјРµРЅС‚Р°СЂРёР№',
  commentPlaceholder: 'РЈС‚РѕС‡РЅРµРЅРёСЏ РїРѕ Р·Р°СЏРІРєРµ',
  submitButtonText: 'РћС‚РїСЂР°РІРёС‚СЊ Р·Р°СЏРІРєСѓ',
});

const getNumericOptionValue = (option?: CalculatorFieldOption) => {
  if (!option) {
    return 0;
  }

  if (typeof option.value === 'number') {
    return option.value;
  }

  const numericValue = Number(option.value);
  return Number.isFinite(numericValue) ? numericValue : 0;
};

const getNumericFieldValue = (value: string | number | boolean | undefined) => {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
};

const isNumericField = (field: CalculatorField) =>
  field.type === 'number' ||
  field.type === 'slider' ||
  (field.type === 'input' && field.inputSubtype === 'number');

const isFormulaField = (field: CalculatorField) =>
  isNumericField(field) ||
  field.type === 'checkbox' ||
  field.type === 'select' ||
  field.type === 'radio' ||
  field.type === 'booking';

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SAFE_FORMULA_CHARS_PATTERN = /^[\d\s+\-*/().,_a-zA-Z]+$/;
const SAFE_FORMULA_TOKEN_PATTERN =
  /(basePrice|globalCoefficient|field_\d+|\d+(?:[.,]\d+)?|[()+\-*/])/g;
const BASE_PRICE_FORMULA_LABEL = 'Базовая цена';
const GLOBAL_COEFFICIENT_FORMULA_LABEL = 'Общий коэффициент';

const normalizeFormula = (formula: string, fields: CalculatorField[]) => {
  let nextFormula = formula;

  const sortedFields = [...fields].sort((left, right) => right.label.length - left.label.length);

  sortedFields.forEach((field, index) => {
    const token = `field_${index + 1}`;
    const trimmedLabel = field.label.trim();

    if (trimmedLabel) {
      nextFormula = nextFormula.replace(new RegExp(escapeRegExp(trimmedLabel), 'g'), token);
    }
  });

  nextFormula = nextFormula
    .replace(new RegExp(escapeRegExp(BASE_PRICE_FORMULA_LABEL), 'g'), 'basePrice')
    .replace(
      new RegExp(escapeRegExp(GLOBAL_COEFFICIENT_FORMULA_LABEL), 'g'),
      'globalCoefficient',
    );

  return nextFormula;
};

const isSafeFormulaExpression = (formula: string) => {
  const normalizedFormula = formula.replace(/,/g, '.').trim();
  if (!normalizedFormula || !SAFE_FORMULA_CHARS_PATTERN.test(normalizedFormula)) {
    return false;
  }

  const compactFormula = normalizedFormula.replace(/\s+/g, '');
  const matchedFormula = (normalizedFormula.match(SAFE_FORMULA_TOKEN_PATTERN) || []).join('');
  return compactFormula === matchedFormula.replace(/\s+/g, '');
};

const getCheckboxSelectedIds = (value: CalculatorFieldValue) =>
  Array.isArray(value) ? value.map(String) : value ? ['__primary__'] : [];

const getCheckboxAmount = (field: CalculatorField, value: CalculatorFieldValue) => {
  const selectedIds = getCheckboxSelectedIds(value);
  const primaryAmount = selectedIds.includes('__primary__')
    ? getNumericFieldValue(field.onValue)
    : getNumericFieldValue(field.offValue);
  const extraAmount = (field.options ?? []).reduce((sum, option) => {
    if (!selectedIds.includes(option.id)) {
      return sum;
    }

    return sum + getNumericOptionValue(option);
  }, 0);

  return primaryAmount + extraAmount;
};


const formatValueLabel = (field: CalculatorField, value: CalculatorFieldValue) => {
  if (field.type === 'checkbox') {
    const selectedIds = getCheckboxSelectedIds(value);
    if (selectedIds.length === 0) {
      return '\u041d\u0435\u0442';
    }

    const labels = [
      ...(selectedIds.includes('__primary__')
        ? [field.checkboxLabel || '\u0412\u043a\u043b\u044e\u0447\u0438\u0442\u044c \u043e\u043f\u0446\u0438\u044e']
        : []),
      ...(field.options ?? [])
        .filter((item) => selectedIds.includes(item.id))
        .map((item) => item.label),
    ];

    return labels.length > 0 ? labels.join(', ') : '\u0414\u0430';
  }

  if (field.type === 'select' || field.type === 'radio') {
    const option = field.options?.find((item) => String(item.value) === String(value));
    return option?.label ?? '\u041d\u0435 \u0432\u044b\u0431\u0440\u0430\u043d\u043e';
  }

  if (field.type === 'booking') {
    if (!isBookingValue(value)) {
      return '\u041d\u0435 \u0432\u044b\u0431\u0440\u0430\u043d\u043e';
    }

    return value.surcharge > 0 ? `${value.label} +${value.surcharge} \u20bd` : value.label;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item : item.name))
      .join(', ');
  }

  return String(value || '');
};

const getFieldAmount = (field: CalculatorField, value: CalculatorFieldValue) => {
  if (isNumericField(field)) {
    const numericValue = Number(value || 0);
    return numericValue * field.unitPrice * field.coefficient;
  }

  if (field.type === 'checkbox') {
    return getCheckboxAmount(field, value) * field.coefficient;
  }

  if (field.type === 'select' || field.type === 'radio') {
    const option = field.options?.find((item) => String(item.value) === String(value));
    return getNumericOptionValue(option) * field.coefficient;
  }

  if (field.type === 'booking') {
    return (isBookingValue(value) ? value.surcharge : 0) * field.coefficient;
  }

  return 0;
};

const compileCustomFormula = (formula: string, context: Record<string, number>) => {
  const keys = Object.keys(context);
  const values = Object.values(context);
  const normalizedFormula = formula.replace(/,/g, '.');

  if (!isSafeFormulaExpression(normalizedFormula)) {
    return 0;
  }

  try {
    const evaluate = new Function(...keys, `return (${normalizedFormula});`);
    const result = Number(evaluate(...values));
    return Number.isFinite(result) ? result : 0;
  } catch {
    return 0;
  }
};

export const buildFormulaContext = (
  template: FormulaTemplateSource,
  values: CalculatorValues,
): Record<string, number> => {
  const numericContext = template.fields.reduce<Record<string, number>>((acc, field, index) => {
    const rawValue = values[field.key];
    const labelToken = `field_${index + 1}`;
    let nextValue = 0;

    if (isNumericField(field)) {
      nextValue = field.useValueInFormula === false ? 0 : Number(rawValue || 0);
    } else if (field.type === 'checkbox') {
      nextValue = field.useValueInFormula === false ? 0 : getCheckboxAmount(field, rawValue);
    } else if (field.type === 'select' || field.type === 'radio') {
      if (field.useValueInFormula === false) {
        nextValue = 0;
      } else {
        const option = field.options?.find((item) => String(item.value) === String(rawValue));
        nextValue = getNumericOptionValue(option);
      }
    } else if (field.type === 'booking') {
      nextValue = field.useValueInFormula === false ? 0 : isBookingValue(rawValue) ? rawValue.surcharge : 0;
    }

    acc[field.key] = nextValue;
    acc[labelToken] = nextValue;

    return acc;
  }, {});

  numericContext.basePrice = template.basePrice;
  numericContext.globalCoefficient = template.globalCoefficient;

  return numericContext;
};

export const evaluateFormulaExpression = (
  expression: string,
  template: FormulaTemplateSource,
  values: CalculatorValues,
) => {
  const trimmedExpression = expression.trim();
  if (!trimmedExpression) {
    return { value: 0, error: 'Р¤РѕСЂРјСѓР»Р° РЅРµ Р·Р°РїРѕР»РЅРµРЅР°' };
  }

  const normalizedExpression = normalizeFormula(trimmedExpression, template.fields);
  const context = buildFormulaContext(template, values);
  const keys = Object.keys(context);
  const args = Object.values(context);

  if (!isSafeFormulaExpression(normalizedExpression)) {
    return { value: 0, error: 'Р¤РѕСЂРјСѓР»Р° СЃРѕРґРµСЂР¶РёС‚ РЅРµРґРѕРїСѓСЃС‚РёРјС‹Рµ СЃРёРјРІРѕР»С‹' };
  }

  try {
    const evaluate = new Function(...keys, `return (${normalizedExpression});`);
    const result = Number(evaluate(...args));
    if (!Number.isFinite(result)) {
      return { value: 0, error: 'Р¤РѕСЂРјСѓР»Р° РІРµСЂРЅСѓР»Р° РЅРµС‡РёСЃР»РѕРІРѕРµ Р·РЅР°С‡РµРЅРёРµ' };
    }

    return { value: result, error: '' };
  } catch {
    return { value: 0, error: 'РћС€РёР±РєР° С„РѕСЂРјСѓР»С‹' };
  }
};

export const formatResultNumber = (
  value: number,
  decimals = 0,
  format: CalculatorField['resultFormat'] = 'space',
) => {
  const safeDecimals = Math.min(6, Math.max(0, decimals));
  const locale = format === 'plain' ? 'en-US' : 'ru-RU';

  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: safeDecimals,
    maximumFractionDigits: safeDecimals,
  }).format(value);
};

export const calculateTemplate = (
  template: CalculatorTemplate,
  values: CalculatorValues,
): CalculationResult => {
  const breakdown: CalculationBreakdownItem[] = template.fields
    .filter((field) => isFormulaField(field) && field.useValueInFormula !== false)
    .map((field) => {
      const rawValue = values[field.key] ?? '';
      const amount = getFieldAmount(field, rawValue);

      return {
        fieldId: field.id,
        label: field.label,
        valueLabel: formatValueLabel(field, rawValue),
        amount,
      };
    })
    .filter((item) => item.amount !== 0);

  const fieldSubtotal = breakdown.reduce((sum, item) => sum + item.amount, 0);
  const simpleSubtotal = (template.basePrice + fieldSubtotal) * template.globalCoefficient;

  let subtotal = simpleSubtotal;

  if (template.formulaMode === 'custom' && template.customFormula.trim()) {
    subtotal = compileCustomFormula(
      normalizeFormula(template.customFormula, template.fields),
      buildFormulaContext(template, values),
    );
  }

  const discountAmount = subtotal * (template.discount / 100);
  const total = Math.max(template.minPrice, Math.round(subtotal - discountAmount));

  return {
    total,
    subtotal: Math.round(subtotal),
    discountAmount: Math.round(discountAmount),
    breakdown,
  };
};

export const createEmptyTemplate = (folderId?: string): CalculatorTemplate => {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  return {
    id,
    folderId,
    requestForm: createDefaultRequestFormSettings(),
    publicationStatus: 'draft',
    publicId: createTemplatePublicId(id.slice(0, 8)),
    publishedAt: undefined,
    lastModifiedBy: 'РђРґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂ',
    title: 'РќРѕРІС‹Р№ РєР°Р»СЊРєСѓР»СЏС‚РѕСЂ',
    description: 'РљСЂР°С‚РєРѕ РѕРїРёС€РёС‚Рµ РЅР°Р·РЅР°С‡РµРЅРёРµ РєР°Р»СЊРєСѓР»СЏС‚РѕСЂР°.',
    type: 'services',
    basePrice: 0,
    discount: 0,
    minPrice: 0,
    globalCoefficient: 1,
    formulaMode: 'simple',
    customFormula: '',
    createdAt: now,
    updatedAt: now,
    fields: [],
  };
};
