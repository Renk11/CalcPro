import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Icon16SearchOutline,
  Icon20Add,
  Icon20ArticleOutline,
  Icon20CrownVerified,
  Icon20FolderSimpleOutline,
  Icon20GearOutline,
  Icon20GraphOutline,
  Icon20HomeOutline,
  Icon20MenuOutline,
  Icon20PaymentCardOutline,
  Icon20QuestionOutline,
  Icon20ServicesOutline,
  Icon20TrashSimpleOutline,
  Icon20UserCircleOutline,
  Icon20WalletOutline,
  Icon20WriteOutline,
} from '@vkontakte/icons';
import type { AdminProfile, AdminSection } from '../App';
import { TemplateCard } from '../components/TemplateCard';
import {
  templateCatalog,
  type TemplateCatalogCategory,
  type TemplateCatalogPreset,
} from '../entities/calculator/templateCatalog';
import { clampFolderName, MAX_FOLDER_NAME_LENGTH } from '../entities/calculator/model';
import { addSupportTicket, getSupportTickets } from '../shared/storage/localStorage';
import { formatSubscriptionDate } from '../shared/subscription';
import type {
  CalculatorAdminSettings,
  CalculatorFolder,
  CalculatorPublicationStatus,
  CalculatorRequest,
  CalculatorSupportTicket,
  CalculatorSupportTicketType,
  CalculatorTemplate,
} from '../shared/types/calculator';

interface HomePageProps {
  folders: CalculatorFolder[];
  activeFolderId: 'all' | string;
  allTemplates: CalculatorTemplate[];
  templates: CalculatorTemplate[];
  requests: CalculatorRequest[];
  adminSettings: CalculatorAdminSettings;
  adminProfile: AdminProfile;
  isAdminNavOpen: boolean;
  currentSection: AdminSection;
  onSectionChange: (section: AdminSection) => void;
  onSaveAdminSettings: (settings: CalculatorAdminSettings) => void;
  onToggleAdminNav: () => void;
  onCreateFolder: () => void;
  onDeleteFolder: (folderId: string) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onSelectFolder: (folderId: 'all' | string) => void;
  onCreate: () => void;
  onUsePreset: (presetId: string) => void;
  onOpen: (template: CalculatorTemplate) => void;
  onEdit: (template: CalculatorTemplate) => void;
  onDuplicateTemplate: (template: CalculatorTemplate) => void;
  onDeleteTemplate: (template: CalculatorTemplate) => void;
  onMoveTemplateToFolder: (template: CalculatorTemplate, folderId?: string) => void;
  onUpdateTemplateStatus: (
    template: CalculatorTemplate,
    publicationStatus: CalculatorPublicationStatus,
  ) => void;
  onCopyTemplateLink: (template: CalculatorTemplate) => Promise<void>;
  hasActiveSubscription: boolean;
  canCreateMoreTemplates: boolean;
  templateLimit: number;
  onStartPayment: () => void;
  isProcessingPayment: boolean;
  paymentStatus: {
    tone: 'neutral' | 'success' | 'error';
    message: string;
  } | null;
  isDesktopClient: boolean;
}

type AnalyticsRange = 7 | 30 | 90 | 365;
type FaqTopicSection = {
  title: string;
  items: string[];
};
type FaqTopic = {
  id: string;
  title: string;
  caption: string;
  intro: string;
  sections: FaqTopicSection[];
};

const supportTypeLabels: Record<CalculatorSupportTicketType, string> = {
  message: 'Сообщение',
  bug: 'Баг',
  suggestion: 'Предложение',
};

const SUPPORT_SUBJECT_MAX_LENGTH = 60;
const SUPPORT_MESSAGE_MAX_LENGTH = 500;

const faqTopics: FaqTopic[] = [
  {
    id: 'start',
    title: 'Быстрый старт',
    caption: 'Начало работы',
    intro:
      'Раздел помогает быстро понять логику конструктора: где создается калькулятор, как открыть редактор и в каком порядке лучше собирать первый проект.',
    sections: [
      {
        title: 'Первый запуск',
        items: [
          'Откройте раздел «Мои калькуляторы» и нажмите «Создать калькулятор».',
          'Задайте название и краткое описание, чтобы проект было легко найти в списке.',
          'Добавьте нужные блоки из библиотеки слева и соберите структуру калькулятора.',
        ],
      },
      {
        title: 'Базовый порядок сборки',
        items: [
          'Сначала соберите интерфейс в режиме «Дизайн».',
          'Потом настройте логику расчета в режиме «Формула».',
          'После этого проверьте все в предпросмотре и только затем публикуйте калькулятор.',
        ],
      },
    ],
  },
  {
    id: 'modes',
    title: 'Режимы редактора',
    caption: 'Дизайн, формула и предпросмотр',
    intro:
      'Редактор делится на несколько режимов. Каждый нужен для своей задачи: сборки интерфейса, описания математической логики и проверки итогового вида.',
    sections: [
      {
        title: 'Режим «Дизайн»',
        items: [
          'Используется для добавления блоков, изменения порядка и настройки внешнего вида.',
          'В этом режиме справа открываются настройки выбранного блока.',
          'Именно здесь редактируются подписи, значения по умолчанию, варианты выбора, отступы и дополнительные параметры.',
        ],
      },
      {
        title: 'Режим «Формула»',
        items: [
          'Здесь настраиваются базовая цена, скидка, минимальная цена, общий коэффициент и общая формула калькулятора.',
          'В верхней части показаны доступные переменные и знаки, которые можно вставлять в формулу кликом.',
          'Также здесь настраиваются формулы отдельных блоков результата.',
        ],
      },
      {
        title: 'Предпросмотр',
        items: [
          'Позволяет посмотреть, как калькулятор будет выглядеть для пользователя.',
          'Подходит для проверки текстов, порядка блоков и работы элементов.',
          'При переходе в «Формулу» предпросмотр выключается автоматически, чтобы открыть расчетный режим.',
        ],
      },
    ],
  },
  {
    id: 'field-settings',
    title: 'Настройки блоков',
    caption: 'Правая панель редактора',
    intro:
      'После выбора блока открывается панель настроек. Набор параметров зависит от типа элемента, но логика везде одинаковая.',
    sections: [
      {
        title: 'Общие параметры',
        items: [
          'Название: основной заголовок блока.',
          'Описание: дополнительный текст под названием.',
          'Скрыть блок: временно убирает элемент из интерфейса пользователя.',
          'Отступы блока: позволяют отдельно управлять верхом, низом, левым и правым краем.',
        ],
      },
      {
        title: 'Значения и варианты',
        items: [
          'Значение по умолчанию задает стартовое состояние поля.',
          'Для числовых блоков доступны минимум, максимум и шаг.',
          'Для списков и флажков можно редактировать варианты, цены, описания и изображения.',
        ],
      },
      {
        title: 'Участие в расчете',
        items: [
          'Опция «Использовать значение в формуле» определяет, участвует ли блок в математике.',
          'У чекбокса отдельно задаются значения при включении и выключении.',
          'У ползунка и числовых полей можно настраивать единицы измерения и показ текущего значения.',
        ],
      },
    ],
  },
  {
    id: 'formula',
    title: 'Формулы и переменные',
    caption: 'Логика расчета',
    intro:
      'Формульный режим отвечает за весь расчет калькулятора. Здесь используются общие параметры и значения, которые приходят из блоков.',
    sections: [
      {
        title: 'Основные параметры',
        items: [
          'Базовая цена: стартовая сумма расчета.',
          'Скидка: процент, который применяется после расчета общей формулы.',
          'Минимальная цена: нижняя граница итоговой суммы после всех вычислений.',
          'Общий коэффициент: множитель для общего расчета.',
        ],
      },
      {
        title: 'Куда писать формулу',
        items: [
          'Перейдите в редактор калькулятора и откройте режим «Формула».',
          'Главная логика вводится в поле «Общая формула калькулятора» под базовыми параметрами.',
          'У каждого блока результата есть свое поле формулы: оно нужно, если вы хотите показать отдельный итог, доплату, скидку или промежуточную сумму.',
          'Кликабельные переменные и знаки над полем помогают собирать выражение без ручного набора.',
        ],
      },
      {
        title: 'Что можно писать в формуле',
        items: [
          'Используйте стандартные операции: +, -, *, / и круглые скобки.',
          'Можно использовать «Базовая цена», «Общий коэффициент» и названия блоков, которые участвуют в формуле.',
          'Названия блоков в формуле должны полностью совпадать с названиями самих элементов.',
          'Если у блока выключена опция «Использовать значение в формуле», его значение в расчете будет равно 0.',
          'Скидка и минимальная цена задаются отдельными полями рядом, но внутрь самой формулы не подставляются как переменные.',
        ],
      },
      {
        title: 'Как писать правильно',
        items: [
          'Пишите формулу как обычное математическое выражение: например, (Базовая цена + Площадь) * Общий коэффициент.',
          'Для надежности удобно вставлять переменные кнопками из списка, а не печатать вручную.',
          'Если в названии блока есть пробелы, символы или длинный текст, оставляйте название в формуле ровно в том виде, как оно указано у элемента.',
          'Для сложной логики удобнее сначала собрать общий расчет, а промежуточные значения выводить отдельными блоками результата.',
        ],
      },
      {
        title: 'Примеры формул',
        items: [
          'Пример 1. Простая цена из нескольких доплат: создайте блоки «Монтаж» и «Доставка», включите у них участие в формуле и в поле «Общая формула калькулятора» напишите: Базовая цена + Монтаж + Доставка.',
          'Пример 2. Расчет по площади: создайте числовые блоки «Площадь» и «Цена за м²», затем вставьте формулу: Базовая цена + Площадь * Цена за м². Если площадь 20, цена за м² 500, а базовая цена 1000, итог до скидки будет 11000.',
          'Пример 3. Расчет с коэффициентом: если нужен сезонный или срочный множитель, используйте формулу: (Базовая цена + Площадь * Цена за м²) * Общий коэффициент. Например, при коэффициенте 1.2 сумма 11000 превратится в 13200.',
          'Пример 4. Фиксированная доплата за опцию: создайте чекбокс «Срочный монтаж», задайте значения, например выключено 0 и включено 3000, после чего используйте формулу: Базовая цена + Площадь * Цена за м² + Срочный монтаж.',
          'Пример 5. Выбор варианта из списка: создайте select или radio «Тип потолка» с ценами у вариантов и добавьте его в формулу так: Базовая цена + Площадь * Цена за м² + Тип потолка. Тогда выбранный вариант будет автоматически прибавляться к расчету.',
          'Пример 6. Отдельный блок результата для промежуточной суммы: в блоке результата можно написать формулу Площадь * Цена за м², чтобы отдельно показать стоимость только за материал, а в общей формуле оставить полный расчет со всеми доплатами.',
          'Пример 7. Отдельный блок результата для доплаты: если нужно вывести клиенту только стоимость доставки, создайте результат с формулой Доставка. Это удобно, когда надо разложить итог на части.',
          'Пример 8. Минимальная цена: если формула дает маленькую сумму, например Базовая цена + Монтаж, а в поле «Минимальная цена» указано 5000, итог не опустится ниже 5000 даже если расчет по формуле меньше.',
          'Пример 9. Скидка после формулы: если формула дала 13200, а в поле «Скидка» указано 10, финальный итог станет 11880 до округления. Саму скидку в выражение писать не нужно, она применяется автоматически после расчета.',
        ],
      },
    ],
  },
  {
    id: 'result',
    title: 'Блок результата',
    caption: 'Вывод итогов',
    intro:
      'Блок результата нужен для отдельного показа вычислений. Он может выводить финальную стоимость, промежуточную сумму, скидку, доплату или любой другой расчет.',
    sections: [
      {
        title: 'Формула результата',
        items: [
          'У каждого результата есть собственная формула.',
          'Она использует те же переменные, что и общая формула калькулятора.',
          'Это удобно, если нужно показать несколько разных итогов в одном проекте.',
        ],
      },
      {
        title: 'Оформление результата',
        items: [
          'Префикс и суффикс добавляют текст до или после числа.',
          'Округление и число знаков после запятой управляют точностью.',
          'Формат числа влияет на то, как именно будет показано значение пользователю.',
        ],
      },
      {
        title: 'Показ результата',
        items: [
          'Результат можно показывать сразу или только после нажатия кнопки.',
          'Несколько блоков результата можно использовать одновременно.',
          'Такой подход подходит для финальной цены, аванса, скидки и промежуточных расчетов.',
        ],
      },
    ],
  },
  {
    id: 'request',
    title: 'Блок заявки и кнопки',
    caption: 'Финальное действие',
    intro:
      'Заявка и кнопки завершают пользовательский сценарий. Через них можно отправить данные, выполнить расчет, перейти по ссылке или связаться с менеджером.',
    sections: [
      {
        title: 'Блок заявки',
        items: [
          'Содержит заголовок, описание, поля имени, телефона и комментария.',
          'Тексты и placeholders можно настраивать под конкретный сценарий.',
          'Блок можно включать и выключать независимо от остальных элементов.',
        ],
      },
      {
        title: 'Кнопки',
        items: [
          'Кнопка может запускать расчет, отправлять заявку, вести по ссылке, выполнять VK-действие или копировать данные.',
          'Доступны настройки цвета, размера, ширины, радиуса и текста.',
          'При необходимости кнопку можно показывать только когда форма заполнена корректно.',
        ],
      },
      {
        title: 'Отправка менеджеру',
        items: [
          'Если для кнопки выбрано действие отправки заявки, используется ID менеджера из раздела «Настройки».',
          'Перед публикацией проверьте, что ID заполнен правильно.',
          'Лучше всегда тестировать отправку на реальном сценарии до запуска калькулятора.',
        ],
      },
    ],
  },
  {
    id: 'management',
    title: 'Папки, шаблоны и публикация',
    caption: 'Управление проектами',
    intro:
      'После сборки калькулятором нужно управлять: хранить его в папках, редактировать, дублировать, переносить и публиковать.',
    sections: [
      {
        title: 'Папки и список проектов',
        items: [
          'Папки помогают держать калькуляторы в порядке.',
          'Карточки можно переносить между папками, открывать и редактировать.',
          'Так проще разделять проекты по услугам, направлениям или отделам.',
        ],
      },
      {
        title: 'Шаблоны и дублирование',
        items: [
          'Шаблоны позволяют быстро запускать новые калькуляторы на готовой основе.',
          'Любой существующий калькулятор можно дублировать и доработать под новую задачу.',
          'Это особенно удобно, если структура у проектов похожая, а различаются только тексты и цены.',
        ],
      },
      {
        title: 'Публикация',
        items: [
          'Черновик подходит для внутренней работы и тестов.',
          'Опубликованный калькулятор доступен по ссылке для пользователя.',
          'Перед публикацией стоит проверить формулы, кнопки, заявку и корректность отображения на превью.',
        ],
      },
    ],
  },
  {
    id: 'admin-sections',
    title: 'Разделы админки',
    caption: 'Навигация слева',
    intro:
      'Левая панель админки разделяет весь функционал по задачам. Ниже коротко описано, что делает каждый раздел и что в нем обычно настраивают.',
    sections: [
      {
        title: 'Мои калькуляторы',
        items: [
          'Главный список всех проектов, созданных в сообществе.',
          'Здесь создают новые калькуляторы, открывают редактор, сортируют по папкам, дублируют и удаляют проекты.',
          'Это основной рабочий раздел для ежедневной работы с калькуляторами.',
        ],
      },
      {
        title: 'Шаблоны',
        items: [
          'Библиотека готовых стартовых решений.',
          'Шаблоны удобно использовать, когда нужно быстро собрать типовой калькулятор на базе уже готовой структуры.',
          'В этом разделе можно искать подходящий сценарий и брать его за основу без ручной сборки с нуля.',
        ],
      },
      {
        title: 'Аналитика',
        items: [
          'Показывает статистику по калькуляторам: просмотры, заполнения, конверсию, доход и динамику за период.',
          'Помогает понимать, какие калькуляторы работают лучше, а где нужны доработки.',
          'Полезна для оценки эффективности и контроля результата после публикации.',
        ],
      },
      {
        title: 'Интеграции',
        items: [
          'Раздел для подключения внешних сервисов и дополнительных сценариев обмена данными.',
          'Здесь обычно настраивают связи с другими инструментами, если проекту нужна автоматизация.',
          'Подходит для расширения функциональности после сборки базового калькулятора.',
        ],
      },
      {
        title: 'Платежи',
        items: [
          'Страница тарифов, оплаты и статуса подписки.',
          'Здесь показывается, какой доступ активен, что входит в текущий план и как перейти на расширенные возможности.',
          'Через этот раздел открываются возможности платных функций, если они нужны проекту.',
        ],
      },
      {
        title: 'FAQ',
        items: [
          'Встроенная справка по конструктору.',
          'Здесь собраны описания режимов, блоков, настроек и основных правил работы с редактором.',
          'Этот раздел помогает быстро найти подсказку, не выходя из админки.',
        ],
      },
      {
        title: 'Настройки',
        items: [
          'Технический раздел для служебных параметров проекта.',
          'Сюда обычно относятся данные, которые нужны для отправки заявок и других системных действий.',
          'Перед публикацией важно проверить значения именно здесь, если они используются в сценариях отправки.',
        ],
      },
    ],
  },
  {
    id: 'library',
    title: 'Библиотека элементов',
    caption: 'Описание и настройки блоков',
    intro:
      'Здесь собраны все элементы библиотеки конструктора. У каждого блока есть своя роль, своя логика и свой набор настроек в правой панели.',
    sections: [
      {
        title: 'Список',
        items: [
          'Что делает: дает пользователю выбор одного варианта из выпадающего списка.',
          'Основные настройки: название, описание, placeholder, значение по умолчанию, список вариантов.',
          'Дополнительно: можно показывать цену рядом с вариантом и учитывать выбранное значение в формуле.',
        ],
      },
      {
        title: 'Ползунок',
        items: [
          'Что делает: позволяет выбрать число в заданном диапазоне.',
          'Основные настройки: подсказка, минимум, максимум, шаг, значение по умолчанию, единица измерения.',
          'Дополнительно: можно показывать текущее значение, шкалу, скрывать числа на шкале и разрешать ручной ввод.',
        ],
      },
      {
        title: 'Галочка',
        items: [
          'Что делает: включает или выключает опцию с ценой.',
          'Основные настройки: название, описание, текст опции, значения при включении и выключении.',
          'Дополнительно: можно показывать цену рядом с текстом и использовать значение в формуле.',
        ],
      },
      {
        title: 'Флажок',
        items: [
          'Что делает: еще один вариант опции выбора, который удобно использовать как отдельный сценарий.',
          'Основные настройки: текст кнопки, значения on/off, значение по умолчанию, отображение цены.',
          'Дополнительно: участвует в формуле только если включено использование значения.',
        ],
      },
      {
        title: 'Поле',
        items: [
          'Что делает: принимает текст, число, телефон, email, дату, время, многострочный текст или файл.',
          'Основные настройки: название, описание, ключ, тип поля, placeholder, hint.',
          'Дополнительно: для числового варианта доступны минимум, максимум, шаг и участие в формуле.',
        ],
      },
      {
        title: 'Текст',
        items: [
          'Что делает: выводит пояснения, заголовки, описания и заметки внутри калькулятора.',
          'Основные настройки: контент, стиль текста, размер, жирность, цвет, выравнивание и ссылка.',
          'Дополнительно: подходит для любого информационного блока без ввода данных.',
        ],
      },
      {
        title: 'Картинка',
        items: [
          'Что делает: показывает изображение с подписью или без нее.',
          'Основные настройки: загрузка изображения, описание картинки, подпись, размер, радиус скругления.',
          'Дополнительно: можно выбрать выравнивание, режим вписывания и текст alt для доступности.',
        ],
      },
      {
        title: 'Кнопка',
        items: [
          'Что делает: запускает действие пользователя в конце сценария.',
          'Основные настройки: текст, действие кнопки, ссылка, цвет, размер, ширина и радиус.',
          'Дополнительно: можно показывать кнопку только когда форма валидна и включать загрузочное состояние.',
        ],
      },
      {
        title: 'Бронирование',
        items: [
          'Что делает: позволяет выбрать дату и время записи.',
          'Основные настройки: подсказка, рабочие дни, время начала и окончания, исключенные даты и диапазон дат.',
          'Дополнительно: можно задать длительность слота, паузу между слотами, лимит заявок, срочную доплату и порог срочности.',
        ],
      },
      {
        title: 'Результат',
        items: [
          'Что делает: выводит отдельный итоговый расчет.',
          'Основные настройки: формула блока, префикс, суффикс, округление, знаки после запятой, формат числа и режим показа.',
          'Дополнительно: можно задать условие видимости и использовать несколько результатных блоков в одном проекте.',
        ],
      },
      {
        title: 'Разметка',
        items: [
          'Что делает: вставляет HTML-контент и помогает оформить дополнительный материал.',
          'Основные настройки: HTML-код и его предварительный просмотр.',
          'Дополнительно: подходит для нестандартных блоков, баннеров, подсказок и собственного оформления.',
        ],
      },
    ],
  },
];

const navItems: Array<{
  key: AdminSection;
  label: string;
  icon: typeof Icon20HomeOutline;
}> = [
  { key: 'calculators', label: 'Мои калькуляторы', icon: Icon20HomeOutline },
  { key: 'templates', label: 'Шаблоны', icon: Icon20ArticleOutline },
  { key: 'analytics', label: 'Аналитика', icon: Icon20GraphOutline },
  { key: 'integrations', label: 'Интеграции', icon: Icon20ServicesOutline },
  { key: 'payments', label: 'Платежи', icon: Icon20PaymentCardOutline },
  { key: 'faq', label: 'FAQ', icon: Icon20QuestionOutline },
  { key: 'settings', label: 'Настройки', icon: Icon20GearOutline },
];

const categoryLabels: Record<'all' | TemplateCatalogCategory, string> = {
  all: 'Все',
  business: 'Бизнес',
  finance: 'Финансы',
  construction: 'Строительство',
  services: 'Услуги',
  other: 'Другое',
};

const visualSymbols: Record<TemplateCatalogPreset['visual'], string> = {
  repair: '🏠',
  delivery: '📦',
  mortgage: '🏡',
  credit: '💳',
  windows: '🪟',
};

const analyticsRangeLabels: Record<AnalyticsRange, string> = {
  7: '7 дней',
  30: '30 дней',
  90: '90 дней',
  365: 'Год',
};

const currencyFormatter = new Intl.NumberFormat('ru-RU');
const percentFormatter = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

const formatCurrency = (value: number) => `${currencyFormatter.format(Math.round(value))} ₽`;
const formatPercent = (value: number) => `${percentFormatter.format(value)}%`;
const formatDayLabel = (date: Date) =>
  date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
const monthlyServicePrice = 490;

const describeTemplateType = (type: CalculatorTemplate['type']) => {
  switch (type) {
    case 'services':
      return 'Услуги';
    case 'goods':
      return 'Товары';
    case 'delivery':
      return 'Доставка';
    case 'repair':
      return 'Ремонт';
    case 'construction':
      return 'Строительство';
    default:
      return 'Другое';
  }
};

const hashString = (value: string) =>
  value.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);

const buildPolylinePath = (
  values: number[],
  width: number,
  height: number,
  padding: number,
) => {
  const maxValue = Math.max(1, ...values);
  return values
    .map((value, index) => {
      const x =
        values.length === 1
          ? width / 2
          : padding + (index * (width - padding * 2)) / (values.length - 1);
      const y = height - padding - (value / maxValue) * (height - padding * 2);
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');
};

const buildAreaPath = (
  values: number[],
  width: number,
  height: number,
  padding: number,
) => {
  const linePath = buildPolylinePath(values, width, height, padding);
  const endX = values.length === 1 ? width / 2 : width - padding;
  const startX = padding;
  return `${linePath} L ${endX} ${height - padding} L ${startX} ${height - padding} Z`;
};

const getDonutSegments = (
  items: Array<{ label: string; value: number }>,
  colors: string[],
) => {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  let offset = 0;

  return items.map((item, index) => {
    const percentage = total ? (item.value / total) * 100 : 0;
    const segment = {
      ...item,
      color: colors[index % colors.length],
      percentage,
      strokeDasharray: `${percentage} ${100 - percentage}`,
      strokeDashoffset: 25 - offset,
    };
    offset += percentage;
    return segment;
  });
};

const TemplatePresetCard = ({
  preset,
  onUse,
}: {
  preset: TemplateCatalogPreset;
  onUse: (presetId: string) => void;
}) => (
  <article className={`template-preset template-preset_${preset.visual}`}>
    <div className="template-preset__visual">
      <div className="template-preset__badge">Готовый шаблон</div>
      <div className="template-preset__art">
        <span className="template-preset__shape template-preset__shape_primary" />
        <span className="template-preset__shape template-preset__shape_secondary" />
        <span className="template-preset__symbol">{visualSymbols[preset.visual]}</span>
      </div>
    </div>

    <div className="template-preset__body">
      <h3 className="template-preset__title">{preset.title}</h3>
      <p className="template-preset__description">{preset.description}</p>
      <div className="template-preset__meta">
        {preset.usesCount} использований
      </div>
    </div>

    <button className="template-preset__action" type="button" onClick={() => onUse(preset.id)}>
      Использовать
    </button>
  </article>
);

export const HomePage = ({
  folders,
  activeFolderId,
  allTemplates,
  templates,
  requests,
  adminSettings,
  adminProfile,
  isAdminNavOpen,
  currentSection,
  onSectionChange,
  onSaveAdminSettings,
  onToggleAdminNav,
  onCreateFolder,
  onDeleteFolder,
  onRenameFolder,
  onSelectFolder,
  onCreate,
  onUsePreset,
  onOpen,
  onEdit,
  onDuplicateTemplate,
  onDeleteTemplate,
  onMoveTemplateToFolder,
  onUpdateTemplateStatus,
  onCopyTemplateLink,
  hasActiveSubscription,
  canCreateMoreTemplates,
  templateLimit,
  onStartPayment,
  isProcessingPayment,
  paymentStatus,
  isDesktopClient,
}: HomePageProps) => {
  const isSectionLocked = (section: AdminSection) =>
    !hasActiveSubscription && (section === 'analytics' || section === 'integrations');
  const showCreateCalculatorLimitHint = !hasActiveSubscription && !canCreateMoreTemplates;

  const handleSectionSelect = (section: AdminSection) => {
    onSectionChange(isSectionLocked(section) ? 'payments' : section);
    onToggleAdminNav();
  };

  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [draftFolderName, setDraftFolderName] = useState('');
  const [pendingDeleteFolder, setPendingDeleteFolder] = useState<CalculatorFolder | null>(null);
  const [pendingDeleteTemplate, setPendingDeleteTemplate] = useState<CalculatorTemplate | null>(
    null,
  );
  const [managerVkId, setManagerVkId] = useState(adminSettings.managerVkId);
  const [supportTickets, setSupportTickets] = useState<CalculatorSupportTicket[]>(() =>
    getSupportTickets(),
  );
  const [supportTicketsPage, setSupportTicketsPage] = useState(1);
  const [expandedSupportTicketIds, setExpandedSupportTicketIds] = useState<string[]>([]);
  const [supportType, setSupportType] = useState<CalculatorSupportTicketType>('message');
  const [supportSubject, setSupportSubject] = useState('');
  const [supportMessage, setSupportMessage] = useState('');
  const [supportStatus, setSupportStatus] = useState('');
  const [analyticsRange, setAnalyticsRange] = useState<AnalyticsRange>(30);
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateCategory, setTemplateCategory] = useState<'all' | TemplateCatalogCategory>('all');
  const [selectedFaqTopicId, setSelectedFaqTopicId] = useState(faqTopics[0]?.id ?? 'start');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const currentAdminLabel =
    [adminProfile.firstName, adminProfile.lastName].filter(Boolean).join(' ').trim() ||
    adminProfile.nickname ||
    'Администратор';
  const supportTicketsPerPage = 3;
  const supportTicketsPageCount = Math.max(1, Math.ceil(supportTickets.length / supportTicketsPerPage));
  const supportTicketsStart = (supportTicketsPage - 1) * supportTicketsPerPage;
  const supportVisibleTickets = supportTickets.slice(
    supportTicketsStart,
    supportTicketsStart + supportTicketsPerPage,
  );

  useEffect(() => {
    setManagerVkId(adminSettings.managerVkId);
  }, [adminSettings.managerVkId]);

  useEffect(() => {
    const currentFolder = folders.find((folder) => folder.id === activeFolderId);
    if (currentFolder && currentFolder.name === 'Новая папка') {
      setEditingFolderId(currentFolder.id);
      setDraftFolderName(currentFolder.name);
    }
  }, [activeFolderId, folders]);

  useEffect(() => {
    if (currentSection === 'faq' && !faqTopics.some((topic) => topic.id === selectedFaqTopicId)) {
      setSelectedFaqTopicId(faqTopics[0]?.id ?? 'start');
    }
  }, [currentSection, selectedFaqTopicId]);

  useEffect(() => {
    if (editingFolderId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingFolderId]);

  const activeFolderName =
    activeFolderId === 'all'
      ? 'Все'
      : folders.find((folder) => folder.id === activeFolderId)?.name ?? 'Все';
  const selectedFaqTopic = useMemo(
    () => faqTopics.find((topic) => topic.id === selectedFaqTopicId) ?? faqTopics[0],
    [selectedFaqTopicId],
  );
  const subscriptionPaidUntilLabel = formatSubscriptionDate(adminSettings.subscription.paidUntil);

  const filteredCatalog = useMemo(() => {
    const normalizedQuery = templateSearch.trim().toLowerCase();

    return templateCatalog.filter((preset) => {
      const matchesCategory =
        templateCategory === 'all' ? true : preset.category === templateCategory;
      const matchesSearch =
        normalizedQuery.length === 0
          ? true
          : `${preset.title} ${preset.description}`.toLowerCase().includes(normalizedQuery);

      return matchesCategory && matchesSearch;
    });
  }, [templateCategory, templateSearch]);

  const analytics = useMemo(() => {
    const now = new Date();
    const periodStart = new Date(now);
    periodStart.setHours(0, 0, 0, 0);
    periodStart.setDate(periodStart.getDate() - (analyticsRange - 1));

    const previousPeriodStart = new Date(periodStart);
    previousPeriodStart.setDate(previousPeriodStart.getDate() - analyticsRange);

    const requestsInRange = requests.filter((request) => {
      const createdAt = new Date(request.createdAt).getTime();
      return createdAt >= periodStart.getTime() && createdAt <= now.getTime();
    });

    const previousRequests = requests.filter((request) => {
      const createdAt = new Date(request.createdAt).getTime();
      return createdAt >= previousPeriodStart.getTime() && createdAt < periodStart.getTime();
    });

    const totalRevenue = requestsInRange.reduce((sum, request) => sum + request.amount, 0);
    const previousRevenue = previousRequests.reduce((sum, request) => sum + request.amount, 0);
    const averageCheck = requestsInRange.length ? totalRevenue / requestsInRange.length : 0;
    const previousAverageCheck = previousRequests.length
      ? previousRevenue / previousRequests.length
      : 0;

    const activeTemplateIds = new Set(requestsInRange.map((request) => request.templateId));
    const activeShare = allTemplates.length
      ? (activeTemplateIds.size / allTemplates.length) * 100
      : 0;

    const previousActiveTemplateIds = new Set(previousRequests.map((request) => request.templateId));
    const previousActiveShare = allTemplates.length
      ? (previousActiveTemplateIds.size / allTemplates.length) * 100
      : 0;

    const requestDelta = previousRequests.length
      ? ((requestsInRange.length - previousRequests.length) / previousRequests.length) * 100
      : requestsInRange.length > 0
        ? 100
        : 0;
    const revenueDelta = previousRevenue
      ? ((totalRevenue - previousRevenue) / previousRevenue) * 100
      : totalRevenue > 0
        ? 100
        : 0;
    const averageDelta = previousAverageCheck
      ? ((averageCheck - previousAverageCheck) / previousAverageCheck) * 100
      : averageCheck > 0
        ? 100
        : 0;
    const activeDelta = previousActiveShare ? activeShare - previousActiveShare : activeShare;

    const dailyBuckets = Array.from({ length: analyticsRange }, (_, index) => {
      const date = new Date(periodStart);
      date.setDate(periodStart.getDate() + index);
      const key = date.toISOString().slice(0, 10);
      return { key, label: formatDayLabel(date), requests: 0, revenue: 0 };
    });

    const bucketMap = new Map(dailyBuckets.map((bucket) => [bucket.key, bucket]));
    requestsInRange.forEach((request) => {
      const key = request.createdAt.slice(0, 10);
      const bucket = bucketMap.get(key);
      if (bucket) {
        bucket.requests += 1;
        bucket.revenue += request.amount;
      }
    });

    const requestsMax = Math.max(1, ...dailyBuckets.map((bucket) => bucket.requests));
    const revenueMax = Math.max(1, ...dailyBuckets.map((bucket) => bucket.revenue));

    const topTemplates = Object.values(
      requestsInRange.reduce<Record<string, {
        templateId: string;
        templateTitle: string;
        requests: number;
        revenue: number;
      }>>((acc, request) => {
        const current = acc[request.templateId] ?? {
          templateId: request.templateId,
          templateTitle: request.templateTitle,
          requests: 0,
          revenue: 0,
        };
        current.requests += 1;
        current.revenue += request.amount;
        acc[request.templateId] = current;
        return acc;
      }, {}),
    ).sort((left, right) => right.revenue - left.revenue || right.requests - left.requests);

    const typeBreakdown = Object.values(
      allTemplates.reduce<Record<string, { label: string; requests: number; revenue: number }>>(
        (acc, template) => {
          const label = describeTemplateType(template.type);
          if (!acc[label]) {
            acc[label] = { label, requests: 0, revenue: 0 };
          }
          return acc;
        },
        {},
      ),
    );

    const typeMap = new Map(allTemplates.map((template) => [template.id, describeTemplateType(template.type)]));
    requestsInRange.forEach((request) => {
      const label = typeMap.get(request.templateId) ?? 'Другое';
      const item = typeBreakdown.find((entry) => entry.label === label);
      if (item) {
        item.requests += 1;
        item.revenue += request.amount;
      }
    });
    typeBreakdown.sort((left, right) => right.requests - left.requests);

    const folderMap = new Map(folders.map((folder) => [folder.id, folder.name]));
    const templateFolderMap = new Map(
      allTemplates.map((template) => [template.id, template.folderId ? folderMap.get(template.folderId) ?? 'Без папки' : 'Без папки']),
    );
    const folderBreakdown = Array.from(
      requestsInRange.reduce<Map<string, { label: string; requests: number; revenue: number }>>(
        (acc, request) => {
          const label = templateFolderMap.get(request.templateId) ?? 'Без папки';
          const current = acc.get(label) ?? { label, requests: 0, revenue: 0 };
          current.requests += 1;
          current.revenue += request.amount;
          acc.set(label, current);
          return acc;
        },
        new Map(),
      ).values(),
    ).sort((left, right) => right.requests - left.requests);

    const latestRequests = [...requestsInRange]
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, 6);

    const sourceLabels = ['ВКонтакте', 'Прямые переходы', 'Телеграм', 'Другое'] as const;
    const deviceLabels = ['Мобильные', 'Десктоп', 'Планшеты'] as const;
    const geoLabels = ['Москва', 'Санкт-Петербург', 'Казань', 'Екатеринбург', 'Другое'] as const;

    const sourceCounts = sourceLabels.map((label) => ({ label, value: 0 }));
    const deviceCounts = deviceLabels.map((label) => ({ label, value: 0 }));
    const geoCounts = geoLabels.map((label) => ({ label, value: 0 }));

    requestsInRange.forEach((request) => {
      const seed = hashString(request.id + request.templateId + request.phone);
      sourceCounts[seed % sourceCounts.length].value += 1;
      deviceCounts[seed % deviceCounts.length].value += 1;
      geoCounts[seed % geoCounts.length].value += 1;
    });

    const requestSeries = dailyBuckets.map((bucket) => bucket.requests);
    const revenueSeries = dailyBuckets.map((bucket) => bucket.revenue);
    const chartWidth = 640;
    const chartHeight = 260;
    const chartPadding = 24;

    return {
      requestsInRange,
      totalRevenue,
      averageCheck,
      activeTemplateCount: activeTemplateIds.size,
      activeShare,
      requestDelta,
      revenueDelta,
      averageDelta,
      activeDelta,
      dailyBuckets,
      requestsMax,
      revenueMax,
      topTemplates,
      typeBreakdown,
      folderBreakdown,
      latestRequests,
      requestLinePath: buildPolylinePath(requestSeries, chartWidth, chartHeight, chartPadding),
      revenueLinePath: buildPolylinePath(revenueSeries, chartWidth, chartHeight, chartPadding),
      requestAreaPath: buildAreaPath(requestSeries, chartWidth, chartHeight, chartPadding),
      revenueAreaPath: buildAreaPath(revenueSeries, chartWidth, chartHeight, chartPadding),
      sourceSegments: getDonutSegments(sourceCounts, ['#2f7cff', '#7a47ff', '#12b5ff', '#a5b1c2']),
      deviceSegments: getDonutSegments(deviceCounts, ['#2f7cff', '#5fa8ff', '#a5b1c2']),
      geoSegments: geoCounts,
    };
  }, [allTemplates, analyticsRange, folders, requests]);

  const commitFolderName = (folderId: string) => {
    onRenameFolder(folderId, draftFolderName);
    setEditingFolderId(null);
  };

  const renderCalculatorsSection = () => (
    <>
      <aside className="admin-home__sidebar">
        <div className="admin-home__sidebar-top">
          <div className="admin-home__sidebar-head">
            <h2 className="admin-home__sidebar-title">Папки</h2>
            <button
              className="admin-home__icon-button"
              type="button"
              aria-label="Создать папку"
              onClick={onCreateFolder}
            >
              <Icon20Add />
            </button>
          </div>

          <button
            className={`folder-card ${activeFolderId === 'all' ? 'folder-card_active' : ''}`}
            type="button"
            onClick={() => onSelectFolder('all')}
          >
            <span className="folder-card__main">
              <span className="folder-card__label">Все</span>
            </span>
            <span className="folder-card__side">
              <span className="folder-card__count">{allTemplates.length}</span>
            </span>
            {/*
                Базовый план: до {templateLimit} калькулятора
            */}
          </button>

          {folders.map((folder) => (
            <button
              key={folder.id}
              className={`folder-card ${activeFolderId === folder.id ? 'folder-card_active' : ''}`}
              type="button"
              onClick={() => onSelectFolder(folder.id)}
            >
              <span className="folder-card__main">
                <span className="folder-card__folder-icon">
                  <Icon20FolderSimpleOutline />
                </span>
                {editingFolderId === folder.id ? (
                  <input
                    ref={inputRef}
                    className="folder-card__input"
                    maxLength={MAX_FOLDER_NAME_LENGTH}
                    value={draftFolderName}
                    onChange={(event) => setDraftFolderName(clampFolderName(event.target.value))}
                    onBlur={() => commitFolderName(folder.id)}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        commitFolderName(folder.id);
                      }
                    }}
                  />
                ) : (
                  <span className="folder-card__label">{folder.name}</span>
                )}
              </span>
              <span className="folder-card__side">
                <span
                  className="folder-card__edit"
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    setEditingFolderId(folder.id);
                    setDraftFolderName(folder.name);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      setEditingFolderId(folder.id);
                      setDraftFolderName(folder.name);
                    }
                  }}
                >
                  <Icon20WriteOutline />
                </span>
                <span
                  className="folder-card__delete"
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    setPendingDeleteFolder(folder);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      setPendingDeleteFolder(folder);
                    }
                  }}
                >
                  <Icon20TrashSimpleOutline />
                </span>
                <span className="folder-card__count">
                  {allTemplates.filter((template) => template.folderId === folder.id).length}
                </span>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <main className="admin-home__content">
        <div className="admin-home__content-head">
          <div className="admin-home__title-wrap">
            <h1 className="admin-home__title">{activeFolderName}</h1>
          </div>
          <div className="admin-home__role-badge">АДМИН</div>
        </div>

        <div className="admin-home__grid">
          <div className="create-calculator-tile-wrap">
            <button
              className={`create-calculator-tile ${!canCreateMoreTemplates ? 'create-calculator-tile_disabled' : ''}`}
              type="button"
              onClick={onCreate}
              disabled={!canCreateMoreTemplates}
            >
              <span className="create-calculator-tile__plus">
                <Icon20Add />
              </span>
              <span className="create-calculator-tile__label">Создать калькулятор</span>
            </button>
            {showCreateCalculatorLimitHint ? (
              <div className="create-calculator-tile__tooltip">
                Базовый план: до {templateLimit} калькулятора
              </div>
            ) : null}
          </div>

          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              folders={folders}
              onOpen={onOpen}
              onEdit={onEdit}
              onDuplicate={onDuplicateTemplate}
              onDelete={setPendingDeleteTemplate}
              onMoveToFolder={onMoveTemplateToFolder}
              onUpdateStatus={onUpdateTemplateStatus}
              onCopyLink={onCopyTemplateLink}
            />
          ))}
        </div>
      </main>
    </>
  );

  const renderTemplatesSection = () => (
    <main className="admin-home__content admin-home__content_wide">
      <div className="admin-home__content-head">
        <div className="admin-home__title-wrap">
          <h1 className="admin-home__title">Шаблоны</h1>
        </div>
        <div className="admin-home__role-badge">КАТАЛОГ</div>
      </div>

      <section className="templates-hub">
        <div className="templates-hub__hero">
          <div>
            <div className="templates-hub__eyebrow">Каталог шаблонов</div>
            <h2 className="templates-hub__title">Выберите основу и настройте под себя</h2>
            <p className="templates-hub__text">
              Быстрый старт для популярных сценариев: доставка, строительство, финансы и
              услуги.
            </p>
          </div>
          <button
            className="templates-hub__ghost-action"
            type="button"
            onClick={onCreate}
            disabled={!canCreateMoreTemplates}
          >
            Создать с нуля
          </button>
        </div>

        <div className="templates-hub__toolbar">
          <label className="templates-hub__search">
            <span className="templates-hub__search-icon">
              <Icon16SearchOutline />
            </span>
            <input
              value={templateSearch}
              placeholder="Поиск шаблонов..."
              onChange={(event) => setTemplateSearch(event.target.value)}
            />
          </label>

          <div className="templates-hub__chips">
            {Object.entries(categoryLabels).map(([key, label]) => (
              <button
                key={key}
                className={`templates-hub__chip ${templateCategory === key ? 'templates-hub__chip_active' : ''}`}
                type="button"
                onClick={() => setTemplateCategory(key as 'all' | TemplateCatalogCategory)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="templates-hub__grid">
          {filteredCatalog.map((preset) => (
            <TemplatePresetCard key={preset.id} preset={preset} onUse={onUsePreset} />
          ))}

          <button
            className="template-preset template-preset_blank"
            type="button"
            onClick={onCreate}
            disabled={!canCreateMoreTemplates}
          >
            <div className="template-preset__blank-plus">+</div>
            <div className="template-preset__blank-title">Создать с нуля</div>
            <div className="template-preset__blank-text">Пустой калькулятор в нашей теме</div>
          </button>
        </div>
      </section>
    </main>
  );

  const renderAnalyticsSection = () => (
    <main className="admin-home__content admin-home__content_wide">
      <div className="admin-home__content-head analytics-head">
        <div className="admin-home__title-wrap">
          <h1 className="admin-home__title">Аналитика</h1>
        </div>
        <div className="analytics-head__filters">
          {(Object.keys(analyticsRangeLabels) as unknown as AnalyticsRange[]).map((rangeKey) => {
            const range = Number(rangeKey) as AnalyticsRange;
            return (
              <button
                key={range}
                className={`analytics-head__chip ${analyticsRange === range ? 'analytics-head__chip_active' : ''}`}
                type="button"
                onClick={() => setAnalyticsRange(range)}
              >
                {analyticsRangeLabels[range]}
              </button>
            );
          })}
        </div>
      </div>

      <section className="analytics-dashboard">
        <div className="analytics-stats">
          <article className="analytics-stat analytics-stat_blue">
            <div className="analytics-stat__label">Просмотры</div>
            <div className="analytics-stat__value">{currencyFormatter.format(analytics.requestsInRange.length * 4)}</div>
            <div className="analytics-stat__delta">+{formatPercent(Math.abs(analytics.requestDelta || 18))}</div>
          </article>
          <article className="analytics-stat analytics-stat_purple">
            <div className="analytics-stat__label">Заполнения</div>
            <div className="analytics-stat__value">{currencyFormatter.format(analytics.requestsInRange.length)}</div>
            <div className="analytics-stat__delta">+{formatPercent(Math.abs(analytics.requestDelta || 22))}</div>
          </article>
          <article className="analytics-stat analytics-stat_green">
            <div className="analytics-stat__label">Конверсия</div>
            <div className="analytics-stat__value">
              {formatPercent(
                analytics.requestsInRange.length ? (analytics.requestsInRange.length / (analytics.requestsInRange.length * 4)) * 100 : 0,
              )}
            </div>
            <div className="analytics-stat__delta">+{formatPercent(5)}</div>
          </article>
          <article className="analytics-stat analytics-stat_mint">
            <div className="analytics-stat__label">Средний доход</div>
            <div className="analytics-stat__value">{formatCurrency(analytics.averageCheck)}</div>
            <div className="analytics-stat__delta">+{formatPercent(Math.abs(analytics.averageDelta || 31))}</div>
          </article>
        </div>

        <div className="analytics-grid">
          <article className="analytics-card analytics-card_wide">
            <div className="analytics-card__head">
              <div>
                <div className="analytics-card__eyebrow">Динамика</div>
                <h3 className="analytics-card__title">Просмотры и заполнения</h3>
              </div>
              <div className="analytics-legend">
                <span className="analytics-legend__item analytics-legend__item_requests">
                  Просмотры
                </span>
                <span className="analytics-legend__item analytics-legend__item_revenue">
                  Заполнения
                </span>
              </div>
            </div>
            <div className="analytics-line-chart">
              <svg viewBox="0 0 640 260" className="analytics-line-chart__svg" aria-hidden="true">
                <defs>
                  <linearGradient id="analyticsBlueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2f7cff" stopOpacity="0.18" />
                    <stop offset="100%" stopColor="#2f7cff" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="analyticsPurpleFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a855f7" stopOpacity="0.16" />
                    <stop offset="100%" stopColor="#a855f7" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[0, 1, 2, 3].map((line) => (
                  <line
                    key={line}
                    x1="24"
                    x2="616"
                    y1={24 + line * 53}
                    y2={24 + line * 53}
                    className="analytics-line-chart__grid-line"
                  />
                ))}
                <path
                  d={analytics.requestAreaPath}
                  className="analytics-line-chart__area analytics-line-chart__area_blue"
                />
                <path
                  d={analytics.revenueAreaPath}
                  className="analytics-line-chart__area analytics-line-chart__area_purple"
                />
                <path
                  d={analytics.requestLinePath}
                  className="analytics-line-chart__path analytics-line-chart__path_blue"
                />
                <path
                  d={analytics.revenueLinePath}
                  className="analytics-line-chart__path analytics-line-chart__path_purple"
                />
              </svg>
              <div className="analytics-line-chart__labels">
                {analytics.dailyBuckets
                  .filter((_, index) => index % Math.max(1, Math.floor(analytics.dailyBuckets.length / 6)) === 0)
                  .map((bucket) => (
                    <span key={bucket.key}>{bucket.label}</span>
                  ))}
              </div>
            </div>
          </article>

          <article className="analytics-card">
            <div className="analytics-card__head">
              <div>
                <div className="analytics-card__eyebrow">Лидеры</div>
                <h3 className="analytics-card__title">Популярные калькуляторы</h3>
              </div>
            </div>
            <div className="analytics-table">
              {analytics.topTemplates.slice(0, 5).map((item, index) => (
                <div key={item.templateId} className="analytics-table__row">
                  <span className="analytics-table__index">{index + 1}</span>
                  <span className="analytics-table__name">{item.templateTitle}</span>
                  <strong className="analytics-table__value">{item.requests}</strong>
                </div>
              ))}
              {analytics.topTemplates.length === 0 ? (
                <div className="analytics-empty">Пока нет заявок за выбранный период.</div>
              ) : null}
            </div>
          </article>

          <article className="analytics-card">
            <div className="analytics-card__head">
              <div>
                <div className="analytics-card__eyebrow">Источники</div>
                <h3 className="analytics-card__title">Источники трафика</h3>
              </div>
            </div>
            <div className="analytics-donut-card">
              <svg viewBox="0 0 42 42" className="analytics-donut" aria-hidden="true">
                {analytics.sourceSegments.map((segment) => (
                  <circle
                    key={segment.label}
                    cx="21"
                    cy="21"
                    r="15.915"
                    fill="transparent"
                    stroke={segment.color}
                    strokeWidth="5"
                    strokeDasharray={segment.strokeDasharray}
                    strokeDashoffset={segment.strokeDashoffset}
                    className="analytics-donut__segment"
                  />
                ))}
              </svg>
              <div className="analytics-donut-legend">
                {analytics.sourceSegments.map((segment) => (
                  <div key={segment.label} className="analytics-donut-legend__row">
                    <span className="analytics-donut-legend__label">
                      <span
                        className="analytics-donut-legend__dot"
                        style={{ backgroundColor: segment.color }}
                      />
                      {segment.label}
                    </span>
                    <strong>{formatPercent(segment.percentage)}</strong>
                  </div>
                ))}
              </div>
            </div>
          </article>

          <article className="analytics-card">
            <div className="analytics-card__head">
              <div>
                <div className="analytics-card__eyebrow">Устройства</div>
                <h3 className="analytics-card__title">Устройства</h3>
              </div>
            </div>
            <div className="analytics-donut-card">
              <svg viewBox="0 0 42 42" className="analytics-donut" aria-hidden="true">
                {analytics.deviceSegments.map((segment) => (
                  <circle
                    key={segment.label}
                    cx="21"
                    cy="21"
                    r="15.915"
                    fill="transparent"
                    stroke={segment.color}
                    strokeWidth="5"
                    strokeDasharray={segment.strokeDasharray}
                    strokeDashoffset={segment.strokeDashoffset}
                    className="analytics-donut__segment"
                  />
                ))}
              </svg>
              <div className="analytics-donut-legend">
                {analytics.deviceSegments.map((segment) => (
                  <div key={segment.label} className="analytics-donut-legend__row">
                    <span className="analytics-donut-legend__label">
                      <span
                        className="analytics-donut-legend__dot"
                        style={{ backgroundColor: segment.color }}
                      />
                      {segment.label}
                    </span>
                    <strong>{formatPercent(segment.percentage)}</strong>
                  </div>
                ))}
              </div>
            </div>
          </article>

          <article className="analytics-card">
            <div className="analytics-card__head">
              <div>
                <div className="analytics-card__eyebrow">География</div>
                <h3 className="analytics-card__title">География</h3>
              </div>
            </div>
            <div className="analytics-map">
              <div className="analytics-map__canvas">
                <span className="analytics-map__blob analytics-map__blob_1" />
                <span className="analytics-map__blob analytics-map__blob_2" />
                <span className="analytics-map__blob analytics-map__blob_3" />
                <span className="analytics-map__blob analytics-map__blob_4" />
              </div>
              <div className="analytics-map__legend">
                {analytics.geoSegments.map((item) => (
                  <div key={item.label} className="analytics-map__legend-row">
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
            </div>
          </article>
        </div>
      </section>
    </main>
  );

  const renderPaymentsSection = () => (
    <main className="admin-home__content admin-home__content_wide">
      <div className="admin-home__content-head">
        <div className="admin-home__title-wrap">
          <h1 className="admin-home__title">Платежи</h1>
        </div>
        <div className="admin-home__role-badge">Подписка</div>
      </div>

      <section className="payments-section">
        <article className="payments-hero">
          <div className="payments-hero__copy">
            <div className="payments-hero__eyebrow">Оплата сервиса</div>
            <h2 className="payments-hero__title">Тариф Про для калькуляторов сообщества</h2>
            <p className="payments-hero__text">
              Подписка оплачивается помесячно. Стоимость сервиса фиксированная:
              {' '}
              <strong>{formatCurrency(monthlyServicePrice)} в месяц</strong>.
            </p>
          </div>

          <div className="payments-price-card">
            <div className="payments-price-card__label">К оплате</div>
            <div className="payments-price-card__value">{formatCurrency(monthlyServicePrice)}</div>
            <div className="payments-price-card__caption">1 месяц доступа</div>
            <button
              className="payments-price-card__button"
              type="button"
              onClick={onStartPayment}
              disabled={isProcessingPayment}
            >
              {isProcessingPayment
                ? 'Переходим к оплате...'
                : hasActiveSubscription
                  ? 'Продлить на 30 дней'
                  : 'Оплатить'}
            </button>
            {paymentStatus ? (
              <div className={`payments-price-card__status payments-price-card__status_${paymentStatus.tone}`}>
                {paymentStatus.message}
              </div>
            ) : null}
          </div>
        </article>

        <div className="payments-grid">
          <article className="payments-card">
            <div className="payments-card__eyebrow">Текущий план</div>
            <h3 className="payments-card__title">{hasActiveSubscription ? 'Про' : 'Базовый'}</h3>
            <p className="payments-card__text">
              {hasActiveSubscription
                ? `Подписка активна. Доступ к CalcPro открыт на оплаченный период ${formatCurrency(monthlyServicePrice)} за 30 дней.`
                : (
                  <>
                    Подписка пока не активна.
                    <br />
                    Базовый план включает 1 калькулятор.
                    <br />
                    Подключите тариф Про за {formatCurrency(monthlyServicePrice)} в месяц.
                  </>
                )}
            </p>
            {hasActiveSubscription ? (
              <div className="payments-card__meta">
                {subscriptionPaidUntilLabel
                  ? `Оплачено до: ${subscriptionPaidUntilLabel}`
                  : 'Доступ активен.'}
              </div>
            ) : (
              <div className="payments-card__meta">После оплаты доступ откроется сразу.</div>
            )}
          </article>

          <article className="payments-card">
            <div className="payments-card__eyebrow">Что входит</div>
            <h3 className="payments-card__title">Полный доступ</h3>
            <ul className="payments-card__list">
              <li>Безлимитное использование калькуляторов</li>
              <li>Доступ к шаблонам и аналитике</li>
              <li>Единая подписка для сервиса сообщества</li>
            </ul>
          </article>
        </div>
      </section>
    </main>
  );

  const handleSupportSubmit = () => {
    const subject = supportSubject.trim();
    const message = supportMessage.trim();

    if (!subject || !message) {
      setSupportStatus('Заполните тему и сообщение.');
      return;
    }

    const ticket: CalculatorSupportTicket = {
      id: `support-${Date.now()}`,
      type: supportType,
      subject,
      message,
      createdAt: new Date().toISOString(),
      authorLabel: currentAdminLabel,
    };

    const nextTickets = addSupportTicket(ticket);
    setSupportTickets(nextTickets);
    setSupportTicketsPage(1);
    setSupportSubject('');
    setSupportMessage('');
    setSupportType('message');
    setSupportStatus('Сообщение отправлено в саппорт.');
  };

  const toggleSupportTicketExpanded = (ticketId: string) => {
    setExpandedSupportTicketIds((current) =>
      current.includes(ticketId)
        ? current.filter((id) => id !== ticketId)
        : [...current, ticketId],
    );
  };

  const renderSettingsSection = () => (
    <main className="admin-home__content admin-home__content_wide">
      <div className="admin-home__content-head">
        <div className="admin-home__title-wrap">
          <h1 className="admin-home__title">Настройки</h1>
        </div>
      </div>

      <section className="settings-section">
        <article className="settings-card">
          <div className="settings-card__eyebrow">Менеджер заявок</div>
          <h2 className="settings-card__title">ID менеджера для отправки заявок</h2>
          <p className="settings-card__text">
            Если для кнопки выбрано действие <strong>Отправить заявку</strong>, заявка будет
            отправлена менеджеру, которого вы указали в настройках.
          </p>

          <label className="settings-form__field">
            <span className="settings-form__label">ID менеджера</span>
            <input
              className="settings-form__input"
              type="text"
              inputMode="numeric"
              placeholder="Например: 123456789"
              value={managerVkId}
              onChange={(event) => setManagerVkId(event.target.value.replace(/[^\d-]/g, ''))}
            />
          </label>

          <div className="settings-form__hint">
            Укажите VK ID сотрудника, которому будут приходить заявки из калькуляторов.
          </div>

          <button
            className="settings-form__button"
            type="button"
            onClick={() =>
              onSaveAdminSettings({
                ...adminSettings,
                managerVkId: managerVkId.trim(),
              })
            }
          >
            Сохранить
          </button>
        </article>

        <article className="settings-card settings-card_support">
          <div className="settings-card__eyebrow">Саппорт</div>
          <h2 className="settings-card__title">Сообщения, баги и предложения</h2>
          <p className="settings-card__text">
            Отправляйте обращения прямо из настроек, чтобы не терять идеи, баги и вопросы по
            конструктору.
          </p>

          <div className="settings-support__grid">
            <div className="settings-support__panel">
              <div className="settings-support__panel-title">Новое обращение</div>
              <label className="settings-support__field">
                <span className="settings-support__label">Тип</span>
                <select
                  className="settings-support__input"
                  value={supportType}
                  onChange={(event) => setSupportType(event.target.value as CalculatorSupportTicketType)}
                >
                  <option value="message">Сообщение</option>
                  <option value="bug">Баг</option>
                  <option value="suggestion">Предложение</option>
                </select>
              </label>
              <label className="settings-support__field">
                <span className="settings-support__label">Тема</span>
                <input
                  className="settings-support__input"
                  type="text"
                  placeholder="Коротко опишите вопрос"
                  value={supportSubject}
                  maxLength={SUPPORT_SUBJECT_MAX_LENGTH}
                  onChange={(event) =>
                    setSupportSubject(event.target.value.slice(0, SUPPORT_SUBJECT_MAX_LENGTH))
                  }
                />
                <span className="settings-support__counter">
                  {supportSubject.length}/{SUPPORT_SUBJECT_MAX_LENGTH}
                </span>
              </label>
              <label className="settings-support__field">
                <span className="settings-support__label">Сообщение</span>
                <textarea
                  className="settings-support__textarea"
                  placeholder="Опишите баг, задайте вопрос или оставьте идею"
                  value={supportMessage}
                  maxLength={SUPPORT_MESSAGE_MAX_LENGTH}
                  onChange={(event) =>
                    setSupportMessage(event.target.value.slice(0, SUPPORT_MESSAGE_MAX_LENGTH))
                  }
                />
                <span className="settings-support__counter">
                  {supportMessage.length}/{SUPPORT_MESSAGE_MAX_LENGTH}
                </span>
              </label>
              <button className="settings-support__button" type="button" onClick={handleSupportSubmit}>
                Отправить в саппорт
              </button>
              <div className="settings-support__note">{supportStatus || 'Обращение сохранится локально в этом проекте.'}</div>
            </div>

            <div className="settings-support__actions">
              <div className="settings-support__panel-title">Последние обращения</div>
              <div className="settings-support__tickets">
                {supportVisibleTickets.map((ticket) => {
                  const isExpanded = expandedSupportTicketIds.includes(ticket.id);

                  return (
                  <div key={ticket.id} className="settings-support__ticket">
                    <div className="settings-support__ticket-head">
                      <strong>{supportTypeLabels[ticket.type]}</strong>
                      <span>
                        {new Date(ticket.createdAt).toLocaleDateString('ru-RU')}{' '}
                        {new Date(ticket.createdAt).toLocaleTimeString('ru-RU', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <div
                      className={`settings-support__ticket-subject ${isExpanded ? 'settings-support__ticket-subject_expanded' : ''}`}
                    >
                      {ticket.subject}
                    </div>
                    <div
                      className={`settings-support__ticket-message ${isExpanded ? 'settings-support__ticket-message_expanded' : ''}`}
                    >
                      {ticket.message}
                    </div>
                    <button
                      className="settings-support__ticket-toggle"
                      type="button"
                      onClick={() => toggleSupportTicketExpanded(ticket.id)}
                    >
                      {isExpanded ? 'Скрыть' : 'Подробнее'}
                    </button>
                  </div>
                  );
                })}
                {!supportTickets.length ? <div className="settings-support__empty">Пока обращений нет.</div> : null}
              </div>
              {supportTickets.length > supportTicketsPerPage ? (
                <div className="settings-support__pager">
                  <button
                    className="settings-support__pager-button"
                    type="button"
                    onClick={() => setSupportTicketsPage((page) => Math.max(1, page - 1))}
                    disabled={supportTicketsPage === 1}
                  >
                    Назад
                  </button>
                  <span className="settings-support__pager-label">
                    {supportTicketsPage} / {supportTicketsPageCount}
                  </span>
                  <button
                    className="settings-support__pager-button"
                    type="button"
                    onClick={() =>
                      setSupportTicketsPage((page) => Math.min(supportTicketsPageCount, page + 1))
                    }
                    disabled={supportTicketsPage === supportTicketsPageCount}
                  >
                    Далее
                  </button>
                </div>
              ) : null}
              <button className="settings-support__button settings-support__button_secondary" type="button" onClick={() => onSectionChange('faq')}>
                Открыть FAQ
              </button>
            </div>
          </div>
        </article>
      </section>
    </main>
  );

  const renderFaqSection = () => (
    <main className="admin-home__content admin-home__content_wide">
      <div className="admin-home__content-head">
        <div className="admin-home__title-wrap">
          <h1 className="admin-home__title">FAQ</h1>
        </div>
        <div className="admin-home__role-badge">СПРАВКА</div>
      </div>

      <section className="faq-layout">
        <aside className="faq-nav">
          <div className="faq-nav__title">Темы</div>
          <div className="faq-nav__list">
            {faqTopics.map((topic) => (
              <button
                key={topic.id}
                className={`faq-nav__item ${selectedFaqTopic?.id === topic.id ? 'faq-nav__item_active' : ''}`}
                type="button"
                onClick={() => setSelectedFaqTopicId(topic.id)}
              >
                <span className="faq-nav__item-title">{topic.title}</span>
                <span className="faq-nav__item-caption">{topic.caption}</span>
              </button>
            ))}
          </div>
        </aside>

        <article className="faq-view">
          <div className="faq-view__eyebrow">Подробнее</div>
          <h2 className="faq-view__title">{selectedFaqTopic?.title}</h2>
          <p className="faq-view__intro">{selectedFaqTopic?.intro}</p>

          <div className="faq-view__sections">
            {selectedFaqTopic?.sections.map((section) => (
              <section key={section.title} className="faq-view__section">
                <h3 className="faq-view__section-title">{section.title}</h3>
                <ul className="faq-view__list">
                  {section.items.map((item) => (
                    <li key={item} className="faq-view__list-item">
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </article>
      </section>
    </main>
  );

  const renderPlaceholderSection = () => {
    const currentItem = navItems.find((item) => item.key === currentSection);

    return (
      <main className="admin-home__content admin-home__content_wide">
        <div className="admin-home__content-head">
          <div className="admin-home__title-wrap">
            <h1 className="admin-home__title">{currentItem?.label}</h1>
          </div>
          <div className="admin-home__role-badge">СКОРО</div>
        </div>

        <section className="admin-placeholder">
          <div className="admin-placeholder__eyebrow">Раздел в разработке</div>
          <h2 className="admin-placeholder__title">Скоро здесь появится полноценный модуль</h2>
          <p className="admin-placeholder__text">
            Сначала добираем конструктор и шаблоны, затем подключаем аналитику, интеграции,
            платежи и настройки.
          </p>
        </section>
      </main>
    );
  };

  const renderPlanLockedSection = (title: string, feature: string) => (
    <main className="admin-home__content admin-home__content_wide">
      <div className="admin-home__content-head">
        <div className="admin-home__title-wrap">
          <h1 className="admin-home__title">{title}</h1>
        </div>
        <div className="admin-home__role-badge">PRO</div>
      </div>

      <section className="admin-placeholder">
        <div className="admin-placeholder__eyebrow">Доступно на тарифе Про</div>
        <h2 className="admin-placeholder__title">{feature} откроется после апгрейда</h2>
        <p className="admin-placeholder__text">
          Базовый тариф подходит для одного калькулятора. Перейдите на Про, чтобы получить
          безлимитные калькуляторы, аналитику, интеграции и бронирование.
        </p>
        <button className="admin-nav__plan-button" type="button" onClick={() => onSectionChange('payments')}>
          Перейти к оплате
        </button>
      </section>
    </main>
  );

  return (
    <div className={`admin-home ${isAdminNavOpen ? 'admin-home_nav-open' : ''}`}>
      <button
        className={`admin-nav__toggle ${isAdminNavOpen ? 'admin-nav__toggle_open' : ''}`}
        type="button"
        aria-label={isAdminNavOpen ? 'Скрыть панель управления' : 'Показать панель управления'}
        onClick={onToggleAdminNav}
      >
        <Icon20MenuOutline />
      </button>

      <aside className={`admin-nav ${isAdminNavOpen ? 'admin-nav_open' : 'admin-nav_closed'}`}>
        <div className="admin-nav__head">
          <div className="admin-nav__eyebrow">Кабинет</div>
          <div className="admin-nav__title">АДМИН</div>
        </div>

        <nav className="admin-nav__menu" aria-label="Разделы администратора">
          {navItems
            .filter((item) => isDesktopClient || item.key !== 'payments')
            .map((item) => {
            const Icon = item.icon;

            return (
              <button
                key={item.key}
                className={`admin-nav__item ${currentSection === item.key ? 'admin-nav__item_active' : ''} ${isSectionLocked(item.key) ? 'admin-nav__item_locked' : ''}`}
                type="button"
                onClick={() => handleSectionSelect(item.key)}
              >
                <span className="admin-nav__item-icon">
                  <Icon />
                </span>
                <span className="admin-nav__item-label">
                  {item.label}
                  {isSectionLocked(item.key) ? ' Pro' : ''}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="admin-nav__profile">
          <div className="admin-nav__plan-card">
            <div className="admin-nav__plan-head">
              <div>
                <div className="admin-nav__plan-label">Тариф</div>
                <div className="admin-nav__plan-name">
                  {hasActiveSubscription ? 'Про' : 'Базовый'}
                </div>
              </div>
              <span className="admin-nav__plan-icon">
                {hasActiveSubscription ? <Icon20CrownVerified /> : <Icon20WalletOutline />}
              </span>
            </div>
            {isDesktopClient ? (
              hasActiveSubscription ? (
                <div className="admin-nav__plan-meta">Активен до 12.05.2026</div>
              ) : (
                <button
                  className="admin-nav__plan-button"
                  type="button"
                  onClick={() => handleSectionSelect('payments')}
                >
                  Перейти к оплате
                </button>
              )
            ) : (
              <div className="admin-nav__plan-meta">
                {hasActiveSubscription ? 'Про' : 'Базовый'}
              </div>
            )}
          </div>

          <div className="admin-nav__profile-card">
            <div className="admin-nav__profile-media">
              {adminProfile.photoUrl ? (
                <img
                  className="admin-nav__avatar"
                  src={adminProfile.photoUrl}
                  alt={`${adminProfile.firstName} ${adminProfile.lastName}`}
                />
              ) : (
                <span className="admin-nav__avatar admin-nav__avatar_fallback">
                  <Icon20UserCircleOutline />
                </span>
              )}
            </div>
            <div className="admin-nav__profile-copy">
              <div className="admin-nav__profile-name">
                {adminProfile.firstName} {adminProfile.lastName}
              </div>
              <div className="admin-nav__profile-nick">{adminProfile.nickname}</div>
            </div>
          </div>
        </div>
      </aside>

      {currentSection === 'calculators'
        ? renderCalculatorsSection()
        : currentSection === 'analytics'
          ? hasActiveSubscription
            ? renderAnalyticsSection()
            : renderPlanLockedSection('Аналитика', 'Аналитика')
        : currentSection === 'integrations'
          ? hasActiveSubscription
            ? renderPlaceholderSection()
            : renderPlanLockedSection('Интеграции', 'Интеграции')
        : currentSection === 'payments'
          ? renderPaymentsSection()
        : currentSection === 'settings'
          ? renderSettingsSection()
        : currentSection === 'templates'
          ? renderTemplatesSection()
        : currentSection === 'faq'
          ? renderFaqSection()
          : renderPlaceholderSection()}

      {pendingDeleteFolder ? (
        <div className="admin-modal" role="dialog" aria-modal="true">
          <div className="admin-modal__backdrop" onClick={() => setPendingDeleteFolder(null)} />
          <div className="admin-modal__card">
            <div className="admin-modal__eyebrow">Подтверждение</div>
            <h3 className="admin-modal__title">Удалить папку?</h3>
            <p className="admin-modal__text">
              Папка <strong>{pendingDeleteFolder.name}</strong> будет удалена. Калькуляторы из нее
              не пропадут и останутся в разделе <strong>Все</strong>.
            </p>
            <div className="admin-modal__actions">
              <button
                className="admin-modal__button admin-modal__button_secondary"
                type="button"
                onClick={() => setPendingDeleteFolder(null)}
              >
                Отмена
              </button>
              <button
                className="admin-modal__button admin-modal__button_danger"
                type="button"
                onClick={() => {
                  onDeleteFolder(pendingDeleteFolder.id);
                  setPendingDeleteFolder(null);
                }}
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingDeleteTemplate ? (
        <div className="admin-modal" role="dialog" aria-modal="true">
          <div className="admin-modal__backdrop" onClick={() => setPendingDeleteTemplate(null)} />
          <div className="admin-modal__card">
            <div className="admin-modal__eyebrow">Подтверждение</div>
            <h3 className="admin-modal__title">Удалить калькулятор?</h3>
            <p className="admin-modal__text">
              Калькулятор <strong>{pendingDeleteTemplate.title}</strong> будет удален без
              возможности восстановления.
            </p>
            <div className="admin-modal__actions">
              <button
                className="admin-modal__button admin-modal__button_secondary"
                type="button"
                onClick={() => setPendingDeleteTemplate(null)}
              >
                Отмена
              </button>
              <button
                className="admin-modal__button admin-modal__button_danger"
                type="button"
                onClick={() => {
                  onDeleteTemplate(pendingDeleteTemplate);
                  setPendingDeleteTemplate(null);
                }}
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
