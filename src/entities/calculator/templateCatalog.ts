import type {
  CalculatorField,
  CalculatorTemplate,
  CalculatorType,
  FormulaMode,
} from '../../shared/types/calculator';
import { createDefaultRequestFormSettings, createTemplatePublicId } from './model';

export type TemplateCatalogCategory =
  | 'business'
  | 'finance'
  | 'construction'
  | 'services'
  | 'other';

export interface TemplateCatalogPreset {
  id: string;
  title: string;
  description: string;
  usesCount: number;
  category: TemplateCatalogCategory;
  visual: 'repair' | 'delivery' | 'mortgage' | 'credit' | 'windows';
  type: CalculatorType;
  basePrice: number;
  minPrice: number;
  globalCoefficient: number;
  discount: number;
  formulaMode: FormulaMode;
  customFormula: string;
  fields: CalculatorField[];
}

const numberField = (
  key: string,
  label: string,
  unitPrice: number,
  required = true,
  placeholder = 'Введите число',
): CalculatorField => ({
  id: crypto.randomUUID(),
  key,
  label,
  type: 'number',
  required,
  unitPrice,
  coefficient: 1,
  placeholder,
});

const selectField = (
  key: string,
  label: string,
  options: Array<{ label: string; value: number; description?: string }>,
  placeholder = 'Выберите значение',
): CalculatorField => ({
  id: crypto.randomUUID(),
  key,
  label,
  type: 'select',
  required: true,
  unitPrice: 0,
  coefficient: 1,
  placeholder,
  showOptionPrices: true,
  useValueInFormula: true,
  options: options.map((option) => ({
    id: crypto.randomUUID(),
    ...option,
  })),
});

const checkboxField = (
  key: string,
  label: string,
  unitPrice: number,
  placeholder = 'Включить опцию',
): CalculatorField => ({
  id: crypto.randomUUID(),
  key,
  label,
  type: 'checkbox',
  required: false,
  unitPrice: 0,
  coefficient: 1,
  placeholder,
  checkboxLabel: label,
  onValue: unitPrice,
  offValue: 0,
  defaultValue: false,
  showPriceInline: true,
});

export const templateCatalog: TemplateCatalogPreset[] = [
  {
    id: 'repair-flat',
    title: 'Ремонт квартир',
    description: 'Смета по комнатам, площади и выбранному уровню отделки.',
    usesCount: 125,
    category: 'construction',
    visual: 'repair',
    type: 'repair',
    basePrice: 30000,
    minPrice: 50000,
    globalCoefficient: 1,
    discount: 0,
    formulaMode: 'simple',
    customFormula: '',
    fields: [
      numberField('area', 'Площадь, м²', 3800),
      selectField('level', 'Тип ремонта', [
        { label: 'Эконом', value: 0, description: 'Базовый вариант' },
        { label: 'Капитальный', value: 45000, description: 'Полный цикл работ' },
        { label: 'Дизайнерский', value: 95000, description: 'Премиальная отделка' },
      ]),
      checkboxField('materials', 'Материалы включены', 22000),
    ],
  },
  {
    id: 'delivery-goods',
    title: 'Доставка товаров',
    description: 'Быстрый расчет доставки по расстоянию, весу и срочности.',
    usesCount: 84,
    category: 'business',
    visual: 'delivery',
    type: 'delivery',
    basePrice: 600,
    minPrice: 1200,
    globalCoefficient: 1,
    discount: 0,
    formulaMode: 'simple',
    customFormula: '',
    fields: [
      numberField('distance', 'Расстояние, км', 35),
      numberField('weight', 'Вес, кг', 12),
      selectField('speed', 'Срочность', [
        { label: 'Обычная', value: 0, description: 'Стандартный срок' },
        { label: 'Сегодня', value: 700, description: 'Доставка в течение дня' },
        { label: 'Экспресс 2 часа', value: 1400, description: 'Максимальный приоритет' },
      ]),
    ],
  },
  {
    id: 'mortgage',
    title: 'Ипотечный калькулятор',
    description: 'Расчет платежа по сумме кредита, ставке и сроку.',
    usesCount: 73,
    category: 'finance',
    visual: 'mortgage',
    type: 'custom',
    basePrice: 0,
    minPrice: 0,
    globalCoefficient: 1,
    discount: 0,
    formulaMode: 'custom',
    customFormula:
      '(loanAmount + loanAmount * (interestRate / 100) * loanYears) / (loanYears * 12)',
    fields: [
      numberField('loanAmount', 'Сумма кредита', 0),
      numberField('interestRate', 'Ставка, %', 0),
      numberField('loanYears', 'Срок, лет', 0),
    ],
  },
  {
    id: 'credit',
    title: 'Кредитный калькулятор',
    description: 'Удобный шаблон для расчета ежемесячного платежа и переплаты.',
    usesCount: 58,
    category: 'finance',
    visual: 'credit',
    type: 'custom',
    basePrice: 0,
    minPrice: 0,
    globalCoefficient: 1,
    discount: 0,
    formulaMode: 'custom',
    customFormula: '(creditAmount + creditAmount * (creditRate / 100)) / creditMonths',
    fields: [
      numberField('creditAmount', 'Сумма кредита', 0),
      numberField('creditRate', 'Процентная ставка, %', 0),
      numberField('creditMonths', 'Срок, месяцев', 0),
    ],
  },
  {
    id: 'windows',
    title: 'Расчет окон',
    description: 'Шаблон для стоимости окон по размерам, профилю и монтажу.',
    usesCount: 42,
    category: 'services',
    visual: 'windows',
    type: 'services',
    basePrice: 2500,
    minPrice: 8000,
    globalCoefficient: 1,
    discount: 0,
    formulaMode: 'simple',
    customFormula: '',
    fields: [
      numberField('windowWidth', 'Ширина, см', 40),
      numberField('windowHeight', 'Высота, см', 45),
      selectField('profile', 'Профиль', [
        { label: 'Эконом', value: 0, description: 'Стандартная комплектация' },
        { label: 'Теплый', value: 6500, description: 'Улучшенная теплоизоляция' },
        { label: 'Премиум', value: 12000, description: 'Максимальный комфорт' },
      ]),
      checkboxField('installation', 'Монтаж включен', 8500),
    ],
  },
];

export const createTemplateFromPreset = (
  presetId: string,
  folderId?: string,
): CalculatorTemplate | undefined => {
  const preset = templateCatalog.find((item) => item.id === presetId);
  if (!preset) {
    return undefined;
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  return {
    id,
    folderId,
    title: preset.title,
    description: preset.description,
    requestForm: createDefaultRequestFormSettings(),
    publicationStatus: 'draft',
    publicId: createTemplatePublicId(id.slice(0, 8)),
    publishedAt: undefined,
    lastModifiedBy: 'Администратор',
    type: preset.type,
    basePrice: preset.basePrice,
    discount: preset.discount,
    minPrice: preset.minPrice,
    globalCoefficient: preset.globalCoefficient,
    formulaMode: preset.formulaMode,
    customFormula: preset.customFormula,
    createdAt: now,
    updatedAt: now,
    fields: preset.fields.map((field) => ({
      ...field,
      id: crypto.randomUUID(),
      options: field.options?.map((option) => ({
        ...option,
        id: crypto.randomUUID(),
      })),
    })),
  };
};
