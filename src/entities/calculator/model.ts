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
const createFormulaAliasPattern = (alias: string) => new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(alias)}(?![\\p{L}\\p{N}_])`, 'giu');

const BASE_PRICE_FORMULA_LABEL = 'Базовая цена';
const GLOBAL_COEFFICIENT_FORMULA_LABEL = 'Общий коэффициент';
const FORMULA_FUNCTION_ALIASES = [
  { aliases: ['ifElse', 'IF', 'ЕСЛИ'], target: 'ifElse' },
  { aliases: ['min', 'MIN', 'МИН'], target: 'min' },
  { aliases: ['max', 'MAX', 'МАКС'], target: 'max' },
  { aliases: ['round', 'ROUND', 'ОКРУГЛ'], target: 'round' },
  { aliases: ['abs', 'ABS', 'МОДУЛЬ'], target: 'abs' },
] as const;

type FormulaRuntimeValue = number | boolean;

type FormulaToken =
  | { type: 'number'; value: number; position: number }
  | { type: 'identifier'; value: string; position: number }
  | { type: 'operator'; value: string; position: number }
  | { type: 'paren'; value: '(' | ')'; position: number }
  | { type: 'comma'; value: ','; position: number }
  | { type: 'eof'; value: ''; position: number };

class FormulaSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormulaSyntaxError';
  }
}

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
      nextFormula = nextFormula.replace(createFormulaAliasPattern(alias), target);
    });
  });

  return nextFormula;
};

const formatFormulaTokenLabel = (token: FormulaToken) => {
  if (token.type === 'number') {
    return String(token.value);
  }

  return token.value || 'конец формулы';
};

const isIdentifierStart = (char: string) => /[\p{L}_]/u.test(char);
const isIdentifierPart = (char: string) => /[\p{L}\p{N}_]/u.test(char);

const tokenizeFormula = (formula: string): FormulaToken[] => {
  const tokens: FormulaToken[] = [];
  let cursor = 0;

  while (cursor < formula.length) {
    const char = formula[cursor];

    if (/\s/.test(char)) {
      cursor += 1;
      continue;
    }

    const nextTwoChars = formula.slice(cursor, cursor + 2);
    if (['>=', '<=', '==', '!=', '&&', '||'].includes(nextTwoChars)) {
      tokens.push({ type: 'operator', value: nextTwoChars, position: cursor });
      cursor += 2;
      continue;
    }

    if (['+', '-', '*', '/', '<', '>'].includes(char)) {
      tokens.push({ type: 'operator', value: char, position: cursor });
      cursor += 1;
      continue;
    }

    if (char === '(' || char === ')') {
      tokens.push({ type: 'paren', value: char, position: cursor });
      cursor += 1;
      continue;
    }

    if (char === ',') {
      tokens.push({ type: 'comma', value: ',', position: cursor });
      cursor += 1;
      continue;
    }

    if (/\d/.test(char) || ((char === '.' || char === ',') && /\d/.test(formula[cursor + 1] ?? ''))) {
      const start = cursor;
      let numberValue = '';
      let hasDecimalSeparator = false;

      while (cursor < formula.length) {
        const currentChar = formula[cursor];

        if (/\d/.test(currentChar)) {
          numberValue += currentChar;
          cursor += 1;
          continue;
        }

        const nextChar = formula[cursor + 1] ?? '';
        if ((currentChar === '.' || currentChar === ',') && !hasDecimalSeparator && /\d/.test(nextChar)) {
          hasDecimalSeparator = true;
          numberValue += '.';
          cursor += 1;
          continue;
        }

        break;
      }

      const parsedValue = Number(numberValue);
      if (!Number.isFinite(parsedValue)) {
        throw new FormulaSyntaxError('Некорректное число в формуле');
      }

      tokens.push({ type: 'number', value: parsedValue, position: start });
      continue;
    }

    if (isIdentifierStart(char)) {
      const start = cursor;
      let identifier = char;
      cursor += 1;

      while (cursor < formula.length && isIdentifierPart(formula[cursor])) {
        identifier += formula[cursor];
        cursor += 1;
      }

      tokens.push({ type: 'identifier', value: identifier, position: start });
      continue;
    }

    throw new FormulaSyntaxError(`Недопустимый символ "${char}" в формуле`);
  }

  tokens.push({ type: 'eof', value: '', position: formula.length });
  return tokens;
};

const createFormulaRuntime = (context: Record<string, number>) => ({
  ...context,
  ifElse: (condition: FormulaRuntimeValue, truthy: FormulaRuntimeValue, falsy: FormulaRuntimeValue) =>
    (typeof condition === 'boolean' ? condition : Number(condition || 0) !== 0)
      ? Number(truthy || 0)
      : Number(falsy || 0),
  min: (...values: FormulaRuntimeValue[]) => {
    if (values.length === 0) {
      throw new FormulaSyntaxError('Функция "Мин" требует хотя бы одно значение');
    }

    return Math.min(...values.map((value) => Number(value || 0)));
  },
  max: (...values: FormulaRuntimeValue[]) => {
    if (values.length === 0) {
      throw new FormulaSyntaxError('Функция "Макс" требует хотя бы одно значение');
    }

    return Math.max(...values.map((value) => Number(value || 0)));
  },
  round: (value: FormulaRuntimeValue, precision: FormulaRuntimeValue = 0) => {
    const digits = Math.max(0, Math.min(6, Math.trunc(Number(precision || 0))));
    const multiplier = 10 ** digits;
    return Math.round(Number(value || 0) * multiplier) / multiplier;
  },
  abs: (value: FormulaRuntimeValue) => Math.abs(Number(value || 0)),
});

type FormulaRuntime = ReturnType<typeof createFormulaRuntime>;

class FormulaParser {
  private readonly runtime: FormulaRuntime;

  private readonly tokens: FormulaToken[];

  private cursor = 0;

  constructor(tokens: FormulaToken[], runtime: FormulaRuntime) {
    this.tokens = tokens;
    this.runtime = runtime;
  }

  parse() {
    const result = this.parseLogicalOr();
    if (this.current().type !== 'eof') {
      throw new FormulaSyntaxError(`Лишний элемент "${formatFormulaTokenLabel(this.current())}" в конце формулы`);
    }

    return result;
  }

  private current() {
    return this.tokens[this.cursor];
  }

  private consume() {
    const token = this.tokens[this.cursor];
    this.cursor += 1;
    return token;
  }

  private matchOperator(...values: string[]) {
    const token = this.current();
    if (token.type === 'operator' && values.includes(token.value)) {
      this.cursor += 1;
      return token.value;
    }

    return null;
  }

  private matchComma() {
    if (this.current().type === 'comma') {
      this.cursor += 1;
      return true;
    }

    return false;
  }

  private matchParen(value: '(' | ')') {
    const token = this.current();
    if (token.type === 'paren' && token.value === value) {
      this.cursor += 1;
      return true;
    }

    return false;
  }

  private expectParen(value: '(' | ')', message: string) {
    if (!this.matchParen(value)) {
      throw new FormulaSyntaxError(message);
    }
  }

  private toNumber(value: FormulaRuntimeValue) {
    const numericValue = typeof value === 'boolean' ? (value ? 1 : 0) : Number(value);
    if (!Number.isFinite(numericValue)) {
      throw new FormulaSyntaxError('Формула вернула нечисловое значение');
    }

    return numericValue;
  }

  private toBoolean(value: FormulaRuntimeValue) {
    return typeof value === 'boolean' ? value : this.toNumber(value) !== 0;
  }

  private parseLogicalOr(): FormulaRuntimeValue {
    let left = this.parseLogicalAnd();

    while (this.matchOperator('||')) {
      const right = this.parseLogicalAnd();
      left = this.toBoolean(left) || this.toBoolean(right);
    }

    return left;
  }

  private parseLogicalAnd(): FormulaRuntimeValue {
    let left = this.parseEquality();

    while (this.matchOperator('&&')) {
      const right = this.parseEquality();
      left = this.toBoolean(left) && this.toBoolean(right);
    }

    return left;
  }

  private parseEquality(): FormulaRuntimeValue {
    let left = this.parseComparison();

    while (true) {
      const operator = this.matchOperator('==', '!=');
      if (!operator) {
        return left;
      }

      const right = this.parseComparison();
      const leftValue = this.toNumber(left);
      const rightValue = this.toNumber(right);
      left = operator === '==' ? leftValue === rightValue : leftValue !== rightValue;
    }
  }

  private parseComparison(): FormulaRuntimeValue {
    let left = this.parseAdditive();

    while (true) {
      const operator = this.matchOperator('>', '<', '>=', '<=');
      if (!operator) {
        return left;
      }

      const right = this.parseAdditive();
      const leftValue = this.toNumber(left);
      const rightValue = this.toNumber(right);

      switch (operator) {
        case '>':
          left = leftValue > rightValue;
          break;
        case '<':
          left = leftValue < rightValue;
          break;
        case '>=':
          left = leftValue >= rightValue;
          break;
        default:
          left = leftValue <= rightValue;
          break;
      }
    }
  }

  private parseAdditive(): FormulaRuntimeValue {
    let left = this.parseMultiplicative();

    while (true) {
      const operator = this.matchOperator('+', '-');
      if (!operator) {
        return left;
      }

      const right = this.parseMultiplicative();
      left =
        operator === '+'
          ? this.toNumber(left) + this.toNumber(right)
          : this.toNumber(left) - this.toNumber(right);
    }
  }

  private parseMultiplicative(): FormulaRuntimeValue {
    let left = this.parseUnary();

    while (true) {
      const operator = this.matchOperator('*', '/');
      if (!operator) {
        return left;
      }

      const right = this.parseUnary();
      if (operator === '*') {
        left = this.toNumber(left) * this.toNumber(right);
        continue;
      }

      const divisor = this.toNumber(right);
      if (divisor === 0) {
        throw new FormulaSyntaxError('Деление на ноль');
      }

      left = this.toNumber(left) / divisor;
    }
  }

  private parseUnary(): FormulaRuntimeValue {
    const operator = this.matchOperator('+', '-');
    if (!operator) {
      return this.parsePrimary();
    }

    const value = this.parseUnary();
    return operator === '+' ? this.toNumber(value) : -this.toNumber(value);
  }

  private parsePrimary(): FormulaRuntimeValue {
    const token = this.current();

    if (token.type === 'number') {
      this.consume();
      return token.value;
    }

    if (token.type === 'identifier') {
      this.consume();

      if (this.matchParen('(')) {
        return this.parseFunctionCall(token.value);
      }

      const runtimeValue = this.runtime[token.value as keyof FormulaRuntime];
      if (typeof runtimeValue === 'number' || typeof runtimeValue === 'boolean') {
        return runtimeValue;
      }

      throw new FormulaSyntaxError(`Переменная "${token.value}" не найдена`);
    }

    if (this.matchParen('(')) {
      const result = this.parseLogicalOr();
      this.expectParen(')', 'Не закрыта скобка в формуле');
      return result;
    }

    if (token.type === 'eof') {
      throw new FormulaSyntaxError('Формула обрывается слишком рано');
    }

    throw new FormulaSyntaxError(`Ожидается значение, а найдено "${formatFormulaTokenLabel(token)}"`);
  }

  private parseFunctionCall(name: string): FormulaRuntimeValue {
    const args: FormulaRuntimeValue[] = [];

    if (!this.matchParen(')')) {
      while (true) {
        args.push(this.parseLogicalOr());
        if (this.matchParen(')')) {
          break;
        }

        if (!this.matchComma()) {
          throw new FormulaSyntaxError(`Ожидается запятая или ")" в функции "${name}"`);
        }
      }
    }

    switch (name) {
      case 'ifElse':
        if (args.length !== 3) {
          throw new FormulaSyntaxError('Функция "Если" должна содержать 3 аргумента');
        }

        return this.runtime.ifElse(args[0], args[1], args[2]);
      case 'min':
        if (args.length === 0) {
          throw new FormulaSyntaxError('Функция "Мин" должна содержать хотя бы 1 аргумент');
        }

        return this.runtime.min(...args);
      case 'max':
        if (args.length === 0) {
          throw new FormulaSyntaxError('Функция "Макс" должна содержать хотя бы 1 аргумент');
        }

        return this.runtime.max(...args);
      case 'round':
        if (args.length === 0 || args.length > 2) {
          throw new FormulaSyntaxError('Функция "Округл" принимает 1 или 2 аргумента');
        }

        return args.length === 1 ? this.runtime.round(args[0]) : this.runtime.round(args[0], args[1]);
      case 'abs':
        if (args.length !== 1) {
          throw new FormulaSyntaxError('Функция "Модуль" принимает 1 аргумент');
        }

        return this.runtime.abs(args[0]);
      default:
        throw new FormulaSyntaxError(`Неизвестная функция "${name}"`);
    }
  }
}

const evaluateNormalizedFormula = (formula: string, context: Record<string, number>) => {
  const trimmedFormula = formula.trim();
  if (!trimmedFormula) {
    return { value: 0, error: 'Формула не заполнена' };
  }

  try {
    const tokens = tokenizeFormula(trimmedFormula);
    const parser = new FormulaParser(tokens, createFormulaRuntime(context));
    const result = parser.parse();
    const numericResult = typeof result === 'boolean' ? (result ? 1 : 0) : Number(result);

    if (!Number.isFinite(numericResult)) {
      return { value: 0, error: 'Формула вернула нечисловое значение' };
    }

    return { value: numericResult, error: '' };
  } catch (error) {
    if (error instanceof FormulaSyntaxError) {
      return { value: 0, error: error.message };
    }

    return { value: 0, error: 'Ошибка формулы' };
  }
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
  return evaluateNormalizedFormula(formula, context).value;
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
  return evaluateNormalizedFormula(normalizedExpression, context);
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
