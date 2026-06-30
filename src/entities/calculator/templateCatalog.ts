import type {
  CalculatorField,
  CalculatorTemplate,
  CalculatorType,
  FormulaMode,
} from '../../shared/types/calculator';
import { createRandomId } from '../../shared/randomId';
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
  visual:
    | 'ceiling'
    | 'stretch'
    | 'repair'
    | 'delivery'
    | 'cleaning'
    | 'mortgage'
    | 'credit'
    | 'windows'
    | 'kitchen'
    | 'furniture';
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
  id: createRandomId(),
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
  id: createRandomId(),
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
    id: createRandomId(),
    ...option,
  })),
});

const checkboxField = (
  key: string,
  label: string,
  unitPrice: number,
  placeholder = 'Включить опцию',
): CalculatorField => ({
  id: createRandomId(),
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
    id: 'ceilings',
    title: 'Потолки',
    description: 'Расчет стоимости потолка по площади, фактуре и количеству светильников.',
    usesCount: 118,
    category: 'construction',
    visual: 'ceiling',
    type: 'construction',
    basePrice: 12000,
    minPrice: 18000,
    globalCoefficient: 1,
    discount: 0,
    formulaMode: 'simple',
    customFormula: '',
    fields: [
      numberField('area', 'Площадь, м²', 950),
      selectField('texture', 'Фактура', [
        { label: 'Матовая', value: 0, description: 'Классическое решение' },
        { label: 'Сатиновая', value: 3500, description: 'Мягкий благородный блеск' },
        { label: 'Глянцевая', value: 5200, description: 'Больше отражения и света' },
      ]),
      numberField('lights', 'Светильники, шт', 650, false),
      checkboxField('cornice', 'Скрытый карниз', 4800),
    ],
  },
  {
    id: 'stretch-ceilings',
    title: 'Натяжные потолки',
    description: 'Готовый шаблон для расчета полотна, профиля, подсветки и монтажа.',
    usesCount: 137,
    category: 'construction',
    visual: 'stretch',
    type: 'construction',
    basePrice: 15000,
    minPrice: 22000,
    globalCoefficient: 1,
    discount: 0,
    formulaMode: 'simple',
    customFormula: '',
    fields: [
      numberField('area', 'Площадь, м²', 1100),
      selectField('canvasType', 'Тип полотна', [
        { label: 'Белое ПВХ', value: 0, description: 'Самый популярный вариант' },
        { label: 'Тканевое', value: 7200, description: 'Премиум-фактура без швов' },
        { label: 'Парящий потолок', value: 9800, description: 'С подсветкой по периметру' },
      ]),
      numberField('angles', 'Доп. углы, шт', 350, false),
      checkboxField('lighting', 'Линейная подсветка', 8900),
    ],
  },
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
    id: 'cleaning',
    title: 'Клининг',
    description: 'Расчет уборки по площади, типу услуги и дополнительным зонам.',
    usesCount: 91,
    category: 'services',
    visual: 'cleaning',
    type: 'services',
    basePrice: 1800,
    minPrice: 3500,
    globalCoefficient: 1,
    discount: 0,
    formulaMode: 'simple',
    customFormula: '',
    fields: [
      numberField('area', 'Площадь, м²', 120),
      selectField('cleaningType', 'Тип уборки', [
        { label: 'Поддерживающая', value: 0, description: 'Быстрый регулярный выезд' },
        { label: 'Генеральная', value: 2800, description: 'Глубокая уборка всей квартиры' },
        { label: 'После ремонта', value: 5400, description: 'Сбор пыли и строительных следов' },
      ]),
      checkboxField('windowsWash', 'Мытье окон', 2400),
      checkboxField('fridge', 'Чистка холодильника', 900),
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
  {
    id: 'kitchens',
    title: 'Кухни на заказ',
    description: 'Расчет кухни по длине, фасадам, столешнице и встроенной технике.',
    usesCount: 104,
    category: 'business',
    visual: 'kitchen',
    type: 'goods',
    basePrice: 45000,
    minPrice: 70000,
    globalCoefficient: 1,
    discount: 0,
    formulaMode: 'simple',
    customFormula: '',
    fields: [
      numberField('length', 'Длина кухни, м', 18000),
      selectField('facade', 'Фасады', [
        { label: 'ЛДСП', value: 0, description: 'Практичный базовый комплект' },
        { label: 'МДФ эмаль', value: 24000, description: 'Гладкие цветные фасады' },
        { label: 'Шпон / массив', value: 46000, description: 'Премиум-сегмент' },
      ]),
      selectField('countertop', 'Столешница', [
        { label: 'Пластик', value: 0, description: 'Стандартное решение' },
        { label: 'Акрил', value: 18000, description: 'Бесшовный современный вид' },
        { label: 'Кварц', value: 39000, description: 'Максимальная износостойкость' },
      ]),
      checkboxField('appliances', 'Встроенная техника', 32000),
    ],
  },
  {
    id: 'furniture',
    title: 'Мебель на заказ',
    description: 'Подходит для шкафов, гардеробных и корпусной мебели с выбором материалов.',
    usesCount: 76,
    category: 'business',
    visual: 'furniture',
    type: 'goods',
    basePrice: 16000,
    minPrice: 28000,
    globalCoefficient: 1,
    discount: 0,
    formulaMode: 'simple',
    customFormula: '',
    fields: [
      numberField('modules', 'Модулей, шт', 4200),
      numberField('height', 'Высота, см', 95),
      selectField('material', 'Материал', [
        { label: 'ЛДСП', value: 0, description: 'Базовый материал' },
        { label: 'МДФ', value: 9500, description: 'Более плотный и долговечный' },
        { label: 'Шпон', value: 22000, description: 'Премиальный внешний вид' },
      ]),
      checkboxField('fittings', 'Премиальная фурнитура', 7800),
    ],
  },
  {
    id: 'repair-turnkey',
    title: 'Ремонт под ключ',
    description: 'Шаблон сметы по площади, типу отделки, санузлам и комплектации материалами.',
    usesCount: 97,
    category: 'construction',
    visual: 'repair',
    type: 'repair',
    basePrice: 40000,
    minPrice: 65000,
    globalCoefficient: 1,
    discount: 0,
    formulaMode: 'simple',
    customFormula: '',
    fields: [
      numberField('area', 'Площадь, м²', 4600),
      selectField('finishLevel', 'Уровень отделки', [
        { label: 'Черновая', value: 0, description: 'Подготовка под дальнейшие работы' },
        { label: 'Чистовая', value: 38000, description: 'Готовое жилое пространство' },
        { label: 'Дизайн-ремонт', value: 86000, description: 'Индивидуальные решения и декор' },
      ]),
      numberField('bathrooms', 'Санузлы, шт', 18500, false),
      checkboxField('materials', 'Закупка материалов подрядчиком', 26000),
    ],
  },
  {
    id: 'delivery-city',
    title: 'Доставка по городу',
    description: 'Быстрый тарифный расчет по расстоянию, весу, этажу и срочности.',
    usesCount: 88,
    category: 'services',
    visual: 'delivery',
    type: 'delivery',
    basePrice: 500,
    minPrice: 990,
    globalCoefficient: 1,
    discount: 0,
    formulaMode: 'simple',
    customFormula: '',
    fields: [
      numberField('distance', 'Расстояние, км', 28),
      numberField('weight', 'Вес, кг', 10),
      selectField('urgency', 'Срочность', [
        { label: 'В течение дня', value: 0, description: 'Стандартная доставка' },
        { label: 'За 3 часа', value: 600, description: 'Повышенный приоритет' },
        { label: 'За 1 час', value: 1200, description: 'Максимально быстро' },
      ]),
      checkboxField('floorLift', 'Подъем на этаж', 450),
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
  const id = createRandomId();

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
      id: createRandomId(),
      options: field.options?.map((option) => ({
        ...option,
        id: createRandomId(),
      })),
    })),
  };
};
