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
import { createRandomId } from '../../shared/randomId';
import { isBookingValue } from './booking';

type FormulaTemplateSource = Pick<CalculatorTemplate, 'basePrice' | 'globalCoefficient' | 'fields'>;

export const MAX_TEMPLATE_TITLE_LENGTH = 24;
export const MAX_TEMPLATE_DESCRIPTION_LENGTH = 80;
export const MAX_FOLDER_NAME_LENGTH = 20;
export const CURRENT_TEMPLATE_SCHEMA_VERSION = 1;

export const clampTemplateTitle = (value: string) =>
  value.slice(0, MAX_TEMPLATE_TITLE_LENGTH);

export const clampTemplateDescription = (value: string) =>
  value.slice(0, MAX_TEMPLATE_DESCRIPTION_LENGTH);

export const clampFolderName = (value: string) => value.slice(0, MAX_FOLDER_NAME_LENGTH);

export const createTemplatePublicId = (seed?: string) => {
  const normalizedSeed = (seed ?? createRandomId().slice(0, 8))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `calc-${normalizedSeed || createRandomId().slice(0, 8)}`;
};

export const createDefaultRequestFormSettings = (): CalculatorRequestFormSettings => ({
  enabled: true,
  title: 'Отправить заявку',
  description: 'Оставьте контакты, и мы свяжемся с вами',
  nameLabel: 'Имя',
  namePlaceholder: 'Как к вам обращаться',
  phoneLabel: 'Телефон',
  phonePlaceholder: '+7 (___) ___-__-__',
  commentLabel: 'Комментарий',
  commentPlaceholder: 'Уточнения по заявке',
  submitButtonText: 'Отправить заявку',
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

const BASE_PRICE_FORMULA_LABEL = 'Базовая цена';
const GLOBAL_COEFFICIENT_FORMULA_LABEL = 'Общий коэффициент';
const FORMULA_FUNCTION_ALIASES = [
  { aliases: ['ifElse', 'IF', 'ЕСЛИ'], target: 'ifElse' },
  { aliases: ['min', 'MIN', 'МИН'], target: 'min' },
  { aliases: ['max', 'MAX', 'МАКС'], target: 'max' },
  { aliases: ['round', 'ROUND', 'ОКРУГЛ'], target: 'round' },
  { aliases: ['abs', 'ABS', 'МОДУЛЬ'], target: 'abs' },
] as const;
const SAFE_FORMULA_TOKEN_PATTERN =
  /(>=|<=|==|!=|&&|\|\||[()+\-*/<>,]|basePrice|globalCoefficient|field_\d+|ifElse|min|max|round|abs|\d+(?:[.,]\d+)?|[a-zA-Z_][a-zA-Z0-9_]*)/g;

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

  FORMULA_FUNCTION_ALIASES.forEach(({ aliases, target }) => {
    aliases.forEach((alias) => {
      nextFormula = nextFormula.replace(new RegExp(escapeRegExp(alias), 'g'), target);
    });
  });

  return nextFormula;
};

const isSafeFormulaExpression = (formula: string) => {
  const normalizedFormula = formula.replace(/,/g, '.').trim();
  if (!normalizedFormula) {
    return false;
  }

  const compactFormula = normalizedFormula.replace(/\s+/g, '');
  const tokens = normalizedFormula.match(SAFE_FORMULA_TOKEN_PATTERN) || [];
  const matchedFormula = tokens.join('');
  if (compactFormula !== matchedFormula.replace(/\s+/g, '')) {
    return false;
  }

  return tokens.every((token) => {
    if (/^(>=|<=|==|!=|&&|\|\||[()+\-*/<>,])$/.test(token)) {
      return true;
    }

    if (/^\d+(?:[.]\d+)?$/.test(token)) {
      return true;
    }

    return (
      token === 'basePrice' ||
      token === 'globalCoefficient' ||
      /^field_\d+$/.test(token) ||
      token === 'ifElse' ||
      token === 'min' ||
      token === 'max' ||
      token === 'round' ||
      token === 'abs'
    );
  });
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
  const runtime = {
    ...context,
    ifElse: (condition: unknown, truthy: number, falsy: number) =>
      condition ? Number(truthy || 0) : Number(falsy || 0),
    min: (...values: number[]) => Math.min(...values.map((value) => Number(value || 0))),
    max: (...values: number[]) => Math.max(...values.map((value) => Number(value || 0))),
    round: (value: number, precision = 0) => {
      const digits = Math.max(0, Math.min(6, Number(precision) || 0));
      const multiplier = 10 ** digits;
      return Math.round(Number(value || 0) * multiplier) / multiplier;
    },
    abs: (value: number) => Math.abs(Number(value || 0)),
  };
  const keys = Object.keys(runtime);
  const values = Object.values(runtime);
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
    return { value: 0, error: 'Формула не заполнена' };
  }

  const normalizedExpression = normalizeFormula(trimmedExpression, template.fields);
  const context = buildFormulaContext(template, values);
  const runtime = {
    ...context,
    ifElse: (condition: unknown, truthy: number, falsy: number) =>
      condition ? Number(truthy || 0) : Number(falsy || 0),
    min: (...items: number[]) => Math.min(...items.map((item) => Number(item || 0))),
    max: (...items: number[]) => Math.max(...items.map((item) => Number(item || 0))),
    round: (value: number, precision = 0) => {
      const digits = Math.max(0, Math.min(6, Number(precision) || 0));
      const multiplier = 10 ** digits;
      return Math.round(Number(value || 0) * multiplier) / multiplier;
    },
    abs: (value: number) => Math.abs(Number(value || 0)),
  };
  const keys = Object.keys(runtime);
  const args = Object.values(runtime);

  if (!isSafeFormulaExpression(normalizedExpression)) {
    return { value: 0, error: 'Формула содержит недопустимые символы' };
  }

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
  const id = createRandomId();

  return {
    schemaVersion: CURRENT_TEMPLATE_SCHEMA_VERSION,
    id,
    folderId,
    requestForm: createDefaultRequestFormSettings(),
    publicationStatus: 'draft',
    publicId: createTemplatePublicId(id.slice(0, 8)),
    publishedAt: undefined,
    lastModifiedBy: 'Администратор',
    title: 'Новый калькулятор',
    description: 'Кратко опишите назначение калькулятора.',
    type: 'services',
    basePrice: 0,
    discount: 0,
    minPrice: 0,
    globalCoefficient: 1,
    formulaMode: 'simple',
    formulaEditorMode: 'visual',
    customFormula: '',
    visualFormulaTokens: [],
    createdAt: now,
    updatedAt: now,
    fields: [],
  };
};
