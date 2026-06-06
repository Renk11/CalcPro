import type {
  CalculationBreakdownItem,
  CalculationResult,
  CalculatorField,
  CalculatorFieldValue,
  CalculatorFieldOption,
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

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
    .replace(/Базовая цена/g, 'basePrice')
    .replace(/Общий коэффициент/g, 'globalCoefficient');

  return nextFormula;
};

const formatValueLabel = (field: CalculatorField, value: CalculatorFieldValue) => {
  if (field.type === 'checkbox') {
    return value ? 'Да' : 'Нет';
  }

  if (field.type === 'select' || field.type === 'radio') {
    const option = field.options?.find((item) => String(item.value) === String(value));
    return option?.label ?? 'Не выбрано';
  }

  if (field.type === 'booking') {
    if (!isBookingValue(value)) {
      return 'РќРµ РІС‹Р±СЂР°РЅРѕ';
    }

    return value.surcharge > 0 ? `${value.label} +${value.surcharge} \u20bd` : value.label;
  }

  if (Array.isArray(value)) {
    return value.map((item) => item.name).join(', ');
  }

  return String(value || '');
};

const getFieldAmount = (field: CalculatorField, value: CalculatorFieldValue) => {
  if (isNumericField(field)) {
    const numericValue = Number(value || 0);
    return numericValue * field.unitPrice * field.coefficient;
  }

  if (field.type === 'checkbox') {
    const checkboxValue = value ? field.onValue : field.offValue;
    return getNumericFieldValue(checkboxValue) * field.coefficient;
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

  try {
    const evaluate = new Function(...keys, `return ${formula};`);
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
      nextValue =
        field.useValueInFormula === false
          ? 0
          : getNumericFieldValue(rawValue ? field.onValue : field.offValue);
    } else if (field.type === 'select' || field.type === 'radio') {
      if (field.useValueInFormula === false) {
        nextValue = 0;
      } else {
        const option = field.options?.find((item) => String(item.value) === String(rawValue));
        nextValue = getNumericOptionValue(option);
      }
    } else if (field.type === 'booking') {
      nextValue = isBookingValue(rawValue) ? rawValue.surcharge : 0;
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
    return { value: 0, error: 'Формула не заполнена' };
  }

  const normalizedExpression = normalizeFormula(trimmedExpression, template.fields);
  const context = buildFormulaContext(template, values);
  const keys = Object.keys(context);
  const args = Object.values(context);

  try {
    const evaluate = new Function(...keys, `return (${normalizedExpression});`);
    const result = Number(evaluate(...args));
    if (!Number.isFinite(result)) {
      return { value: 0, error: 'Формула вернула нечисловое значение' };
    }

    return { value: result, error: '' };
  } catch {
    return { value: 0, error: 'Ошибка формулы' };
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
    .filter((field) => field.type !== 'button' && field.type !== 'result')
    .map((field) => {
    const rawValue = values[field.key] ?? '';

    return {
      fieldId: field.id,
      label: field.label,
      valueLabel: formatValueLabel(field, rawValue),
      amount: getFieldAmount(field, rawValue),
    };
    });

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

  return {
    id: crypto.randomUUID(),
    folderId,
    title: 'Новый калькулятор',
    description: 'Кратко опишите назначение калькулятора.',
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
