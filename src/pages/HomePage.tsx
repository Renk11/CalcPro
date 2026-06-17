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
import {
  addSupportTicket,
  getSupportTickets,
  replaceSupportTickets,
  updateSupportTicketComment,
  updateSupportTicketStatus,
} from '../shared/storage/localStorage';
import type { SubscriptionPlanConfig } from '../shared/subscription';
import { SUBSCRIPTION_PLANS, formatSubscriptionDate, parseSubscriptionDate } from '../shared/subscription';
import type {
  CalculatorAdminSettings,
  CalculatorConnectedCommunity,
  CalculatorFolder,
  CalculatorPublicationStatus,
  CalculatorRequest,
  CalculatorRequestStatus,
  CalculatorSubscriptionPlan,
  CalculatorSupportTicket,
  CalculatorSupportTicketStatus,
  CalculatorSupportTicketType,
  CalculatorTemplate,
} from '../shared/types/calculator';

interface HomePageProps {
  connectedCommunities: CalculatorConnectedCommunity[];
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
  onUpdateRequestStatus: (
    requestId: string,
    status: CalculatorRequestStatus,
  ) => void;
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
  onTransferTemplateToCommunity: (template: CalculatorTemplate, groupId: number) => void;
  onUpdateTemplateStatus: (
    template: CalculatorTemplate,
    publicationStatus: CalculatorPublicationStatus,
  ) => void;
  onCopyTemplateLink: (template: CalculatorTemplate) => Promise<void>;
  currentPlan: SubscriptionPlanConfig;
  configuredPlan: SubscriptionPlanConfig;
  hasActiveSubscription: boolean;
  isSuperAdmin: boolean;
  currentGroupId: number;
  launchGroupId: number;
  canCreateMoreTemplates: boolean;
  canCreateMoreRequests: boolean;
  monthlyRequestsUsed: number;
  requestLimit: number | null;
  canUseTemplates: boolean;
  canUseAnalytics: boolean;
  canUseNotifications: boolean;
  canUseRequestStatuses: boolean;
  canUseFolders: boolean;
  onSelectAdminGroup: (groupId: number) => void;
  onDisconnectCommunity: (groupId: number) => void;
  onStartPayment: (plan: CalculatorSubscriptionPlan) => void;
  onInstallInCommunity: () => void;
  onGrantProAccess: (
    targetGroupId: number,
    days?: number,
  ) => Promise<{ ok: boolean; message: string }>;
  isProcessingPayment: boolean;
  paymentStatus: {
    tone: 'neutral' | 'success' | 'error';
    message: string;
  } | null;
  isDesktopClient: boolean;
  isCompactViewport: boolean;
  isCommunityContext: boolean;
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

const supportStatusLabels: Record<CalculatorSupportTicketStatus, string> = {
  pending: 'На рассмотрении',
  reviewed: 'Рассмотрено',
  rejected: 'Отклонено',
};

const requestStatusLabels: Record<CalculatorRequestStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  done: 'Закрыта',
  rejected: 'Отклонена',
};

const SUPPORT_SUBJECT_MAX_LENGTH = 60;
const SUPPORT_MESSAGE_MAX_LENGTH = 500;
const SUPPORT_COMMENT_MAX_LENGTH = 240;
const SUPPORT_TICKET_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const formatSupportCountdown = (createdAt: string, now: number) => {
  const createdAtMs = Date.parse(createdAt || '');
  if (!Number.isFinite(createdAtMs)) {
    return 'Скоро удалится';
  }

  const remainingMs = createdAtMs + SUPPORT_TICKET_RETENTION_MS - now;
  if (remainingMs <= 0) {
    return 'Удаляется...';
  }

  const totalMinutes = Math.ceil(remainingMs / (1000 * 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `Удалится через ${days} д. ${hours} ч.`;
  }

  if (hours > 0) {
    return `Удалится через ${hours} ч. ${minutes} мин.`;
  }

  return `Удалится через ${minutes} мин.`;
};

const faqTopics: FaqTopic[] = [
  {
    id: 'start',
    title: 'Быстрый старт',
    caption: 'С чего начать',
    intro:
      'Этот раздел поможет собрать первый калькулятор без путаницы. Если идти по шагам ниже, вы быстро получите рабочую форму, корректный расчёт и готовую публикацию внутри сообщества.',
    sections: [
      {
        title: 'Первый калькулятор за 10 минут',
        items: [
          'Откройте раздел «Мои калькуляторы» и нажмите «Создать калькулятор». Задайте понятное название, например: «Расчёт натяжного потолка» или «Калькулятор записи на замер».',
          'Сначала соберите структуру экрана в режиме «Дизайн»: добавьте заголовок, поясняющий текст, изображение, нужные поля, блок результата и кнопку отправки заявки.',
          'После этого перейдите в режим «Формула» и задайте общую логику расчёта: базовую цену, переменные, скидку, минимальную цену и формулы для карточек результата.',
          'В конце откройте предпросмотр, пройдите сценарий как обычный посетитель и убедитесь, что итог меняется правильно, заявка отправляется, а обязательные поля не дают отправить пустую форму.',
        ],
      },
      {
        title: 'Рекомендуемый порядок сборки',
        items: [
          '1 шаг: продумайте сценарий. Что пользователь должен выбрать, что увидеть в результате и какие данные оставить менеджеру.',
          '2 шаг: добавьте поля выбора и ввода. Например: ширина, высота, материал, монтаж, доставка, имя, телефон.',
          '3 шаг: включите участие нужных полей в формуле. Не каждое поле должно участвовать в расчёте: имя и телефон нужны для заявки, а не для цены.',
          '4 шаг: настройте итоговую карточку результата. В ней можно показывать заголовок, основную сумму, подсказку, кнопку и дополнительные строки вроде скидки или минимальной цены.',
          '5 шаг: опубликуйте калькулятор только после теста. Это важно, чтобы в публичной версии сразу открывался рабочий сценарий, а не черновик.',
        ],
      },
      {
        title: 'Пример простого сценария',
        items: [
          'Сценарий «Цена по площади»: пользователь вводит ширину и высоту, выбирает тип материала и включает монтаж. Формула может быть такой: ((Высота / 100) * (Ширина / 100)) * Базовая цена + Материал + Монтаж.',
          'Сценарий «Запись на услугу»: цена может не рассчитываться вообще. Тогда делайте упор на форму: имя, телефон, удобная дата, комментарий, согласие и кнопка отправки.',
          'Сценарий «Коммерческое предложение»: сначала показывайте предварительный расчёт, а потом собирайте контакты через нижний блок результата с кнопкой «Отправить заявку».',
        ],
      },
    ],
  },
  {
    id: 'modes',
    title: 'Режимы редактора',
    caption: 'Дизайн, формула и предпросмотр',
    intro:
      'Редактор разделён на несколько режимов, чтобы было проще работать поэтапно: сначала собираем экран, потом задаём логику, затем проверяем, как всё выглядит для пользователя.',
    sections: [
      {
        title: 'Режим «Дизайн»',
        items: [
          'Здесь вы добавляете блоки из библиотеки, меняете их порядок, удаляете лишнее и настраиваете внешний вид каждого элемента.',
          'После выбора блока справа открывается панель настроек. Через неё меняются подписи, значения по умолчанию, варианты выбора, отступы, состояния и дополнительные параметры.',
          'Именно в этом режиме собирается весь пользовательский сценарий: что посетитель увидит первым, где будет изображение, как расположен итог, где стоит форма заявки.',
        ],
      },
      {
        title: 'Режим «Формула»',
        items: [
          'Используется для всей математической логики: общей формулы калькулятора, базовой цены, скидки, минимальной цены, коэффициента и отдельных формул блоков результата.',
          'В верхней части доступны переменные и математические знаки. Их удобно вставлять кликом, чтобы не ошибаться в названиях полей.',
          'Если формула не срабатывает, чаще всего причина в одном из трёх пунктов: неверное имя переменной, у поля выключено участие в формуле или выражение содержит ошибку в скобках.',
        ],
      },
      {
        title: 'Предпросмотр',
        items: [
          'Показывает калькулятор так, как его увидит посетитель. Это обязательный этап перед публикацией.',
          'В предпросмотре удобно проверять порядок блоков, тексты, состояние кнопок, нижнюю карточку результата, чекбоксы согласия, маску телефона и поведение полей.',
          'Если вы работаете с фиксированным блоком результата у нижнего края, обязательно проверьте мобильный экран: карточка должна быть всегда видна, но не перекрывать ввод.',
        ],
      },
    ],
  },
  {
    id: 'field-settings',
    title: 'Настройки блоков',
    caption: 'Как работает правая панель',
    intro:
      'У каждого блока свои параметры, но логика у всех одинаковая: вы выбираете элемент на холсте и настраиваете его справа. Чем аккуратнее заполнены названия, подписи и состояния, тем проще потом писать формулу и собирать заявку.',
    sections: [
      {
        title: 'Общие настройки',
        items: [
          'Название блока. Это главный идентификатор элемента. Если блок участвует в формуле, используйте короткие и понятные названия: «Ширина», «Высота», «Материал», «Монтаж».',
          'Описание или подсказка. Нужны, чтобы объяснить пользователю, что именно вводить. Например: «Введите размер в сантиметрах» или «Выберите вариант ткани».',
          'Скрытие блока. Полезно для черновой настройки или временного отключения элемента без удаления.',
          'Отступы и внешний вид. Помогают сделать экран чище: отделить заголовки, не слипать поля, красиво оформить карточки и блоки информации.',
        ],
      },
      {
        title: 'Значения по умолчанию',
        items: [
          'Для числовых полей задавайте стартовое значение, если хотите, чтобы посетитель сразу видел пример расчёта.',
          'Для списков и переключателей можно указать вариант по умолчанию. Это удобно, когда у услуги есть самый популярный сценарий.',
          'Для текстовых полей используйте placeholder как пример: «Введите имя», «+7 (___) ___-__-__», «Комментарий к заказу».',
        ],
      },
      {
        title: 'Участие в расчёте',
        items: [
          'Если поле должно влиять на итог, включите опцию участия в формуле. Без этого его значение не попадёт в расчёт.',
          'Для переключателей и чекбоксов задавайте два состояния: значение при включении и при выключении. Пример: «Монтаж» = 5000 при включении и 0 при выключении.',
          'Для числовых полей и ползунков полезно настраивать единицы измерения, шаг и ограничения. Например: ширина от 50 до 600 см, шаг 10 см.',
        ],
      },
      {
        title: 'Совет по именованию',
        items: [
          'Не используйте слишком длинные названия переменных для расчёта. Лучше «Высота», чем «Высота оконного проёма в сантиметрах».',
          'Если блок нужен только для интерфейса, можно назвать его как угодно. Но если поле участвует в формуле, имя должно быть стабильным и понятным.',
          'Если похожих блоков несколько, используйте уточнения: «Ширина 1», «Ширина 2», «Доп опция», «Доп опция 2». Это избавляет от путаницы в формуле.',
        ],
      },
    ],
  },
  {
    id: 'formula',
    title: 'Формулы и переменные',
    caption: 'Как настроить расчёт',
    intro:
      'Здесь задаётся математическая логика калькулятора. Общая формула считает итоговую сумму, а отдельные формулы внутри результатных блоков помогают показать подытог, скидку, наценку, площадь, стоимость материала и любые другие промежуточные значения.',
    sections: [
      {
        title: 'Что можно использовать в формуле',
        items: [
          'Математические операции: +, -, *, / и круглые скобки.',
          'Базовую цену, общий коэффициент и названия блоков, которые участвуют в формуле.',
          'Значения полей, списков, переключателей, числовых инпутов и ползунков, если у них включено участие в расчёте.',
        ],
      },
      {
        title: 'Где писать формулу',
        items: [
          'Главная формула задаётся в поле «Общая формула калькулятора». Именно она отвечает за основной итог.',
          'У каждого блока результата может быть своя формула. Это удобно, если нужно отдельно показать, например, «Площадь», «Скидка», «Стоимость монтажа» или «Экономия».',
          'Если достаточно одного общего итога, можно ограничиться только общей формулой и не создавать дополнительные расчётные блоки.',
        ],
      },
      {
        title: 'Примеры формул',
        items: [
          'Пример 1. Расчёт площади в квадратных метрах: (Высота / 100) * (Ширина / 100). Если поля в сантиметрах, обязательно делите на 100.',
          'Пример 2. Площадь умножается на стоимость за метр: ((Высота / 100) * (Ширина / 100)) * Базовая цена.',
          'Пример 3. Цена с доплатами: ((Высота / 100) * (Ширина / 100)) * Базовая цена + Дополнительная опция + Сетка.',
          'Пример 4. Цена с коэффициентом: (((Высота / 100) * (Ширина / 100)) * Базовая цена + Монтаж) * Общий коэффициент.',
          'Пример 5. Фиксированная минимальная стоимость: основную формулу пишете как обычно, а минимальную цену задаёте отдельным полем в режиме «Формула». Тогда слишком маленький расчёт не уйдёт ниже порога.',
          'Пример 6. Чекбокс срочности: если блок «Срочность» возвращает 3000 при включении и 0 при выключении, достаточно добавить «+ Срочность» в общую формулу.',
        ],
      },
      {
        title: 'Частые ошибки',
        items: [
          'Название поля в формуле не совпадает с названием блока. Даже лишний пробел может сломать расчёт.',
          'Поле есть на экране, но у него выключено участие в формуле. Тогда оно визуально работает, но значение в расчёт не попадает.',
          'Не хватает скобки или используется неправильный порядок действий. Для сложных выражений всегда ставьте скобки явно.',
          'Формула написана для сантиметров, а пользователь вводит метры. Сразу определитесь с единицей измерения и держите её одинаковой по всему калькулятору.',
        ],
      },
      {
        title: 'Как проверять формулу',
        items: [
          'Сначала соберите самое простое выражение. Например: Ширина * Базовая цена. Убедитесь, что оно работает.',
          'Потом добавляйте по одному элементу: высоту, коэффициент, монтаж, сетку, скидку. Так проще понять, где возникает ошибка.',
          'Если расчёт сложный, вынесите промежуточные значения в отдельные блоки результата. Например: один блок показывает площадь, второй монтаж, третий финальную цену.',
        ],
      },
    ],
  },
  {
    id: 'result',
    title: 'Карточка результата',
    caption: 'Итог, подытог, скидка и кнопка',
    intro:
      'Карточка результата показывает пользователю итог расчёта и подводит к действию. Сейчас она может быть закреплена у нижнего края экрана, всегда оставаться видимой и вести к отправке заявки. Это один из самых важных блоков всего конструктора.',
    sections: [
      {
        title: 'Что можно настроить',
        items: [
          'Показ всего блока результата через отдельный чекбокс в настройках. Это удобно, когда нужно временно скрыть нижнюю плашку.',
          'Заголовок карточки. Например: «Итог расчёта», «Предварительная стоимость», «Итог по заявке».',
          'Основную сумму. Обычно это главный расчёт, например «24 900 ₽».',
          'Дополнительные строки: подытог, скидка, минимальная цена, поясняющий текст и состояние заполненности формы.',
          'Текст кнопки. Например: «Отправить заявку», «Получить расчёт», «Связаться с менеджером».',
        ],
      },
      {
        title: 'Как использовать фиксированный блок снизу',
        items: [
          'Закреплённый блок удобен, когда пользователь скроллит длинную форму, но итог и кнопка должны быть всегда под рукой.',
          'Для такого сценария делайте короткий заголовок, крупную сумму и лаконичную подпись: «Нужно заполнить: имя, телефон, согласие».',
          'Если фон калькулятора светлый, следите за контрастом текста. Лучше корректировать цвет текста и вторичных подписей, чем затемнять весь блок.',
        ],
      },
      {
        title: 'Примеры содержимого',
        items: [
          'Пример 1. Заголовок: «Итог расчёта». Основное значение: «18 500 ₽». Подпись: «Предварительная стоимость, финальная цена уточняется менеджером».',
          'Пример 2. Заголовок: «Итог по заявке». Основное значение: «0 ₽». Подпись до заполнения: «Нужно заполнить: имя, телефон, согласие».',
          'Пример 3. Дополнительная строка скидки: «Скидка 10%: -2 000 ₽». Её удобно показывать отдельным результатным блоком или дополнительной строкой внутри карточки.',
        ],
      },
      {
        title: 'Когда показывать дополнительные значения',
        items: [
          'Подытог полезен, если вы хотите показать цену до скидки.',
          'Скидка нужна, когда важно подчеркнуть выгоду и увеличить конверсию заявки.',
          'Минимальная цена уместна в услугах, где небольшой расчёт не должен вводить пользователя в заблуждение слишком низкой суммой.',
        ],
      },
    ],
  },
  {
    id: 'request',
    title: 'Заявки и менеджеры',
    caption: 'Как приходят обращения',
    intro:
      'После заполнения формы пользователь отправляет заявку, а система передаёт её менеджерам, указанным в настройках приложения. Для вашего текущего сценария заявки должны уходить в группу и распределяться менеджерам так же, как в рабочем проекте Moskitka.',
    sections: [
      {
        title: 'Что нужно для работы заявок',
        items: [
          'Добавьте в калькулятор поля контактов: минимум имя и телефон. Почту, комментарий, адрес, дату или время можно добавлять по необходимости.',
          'Обязательно используйте чекбокс согласия, если собираете персональные данные. Это защищает сценарий и упрощает работу с заявками.',
          'В настройках приложения укажите VK ID менеджеров, которые должны получать обращения. Если менеджеров несколько, их можно перечислять через запятую, пробел или точку с запятой.',
        ],
      },
      {
        title: 'Как выглядит хороший сценарий заявки',
        items: [
          'Сначала пользователь получает предварительный расчёт, затем видит кнопку «Отправить заявку» в карточке результата.',
          'Если обязательные поля не заполнены, карточка подсказывает, чего не хватает: «Нужно заполнить: имя, телефон, согласие».',
          'После заполнения всех обязательных полей кнопка становится рабочей, а заявка уходит менеджерам, указанным в настройках.',
        ],
      },
      {
        title: 'Пример набора полей',
        items: [
          'Имя: текстовое поле, обязательное.',
          'Телефон: поле телефона с маской, обязательное.',
          'Комментарий: многострочное поле, необязательное.',
          'Дата замера: дата или бронирование, если нужно сразу собирать время.',
          'Согласие: чекбокс с текстом вроде «Я согласен на обработку персональных данных».',
        ],
      },
      {
        title: 'Что отправляется менеджеру',
        items: [
          'Название калькулятора или шаблона.',
          'Итоговая сумма и ключевые параметры расчёта.',
          'Контакты пользователя: имя, телефон и дополнительные поля, если они заполнены.',
          'Технически заявка отправляется на сервер, а дальше пересылается менеджерам через токен группы, если он подключён в окружении.',
        ],
      },
    ],
  },
  {
    id: 'management',
    title: 'Публикация и управление',
    caption: 'Черновик, публикация и публичная версия',
    intro:
      'Этот раздел нужен, чтобы не путать редактор, быстрый просмотр и публичную страницу. Калькулятор может выглядеть готовым внутри админки, но для пользователей важно, чтобы была сохранена и опубликована именно серверная версия шаблона.',
    sections: [
      {
        title: 'Черновик и публикация',
        items: [
          'Черновик нужен для работы внутри редактора. Вы можете менять блоки, формулы и тексты без риска сразу сломать публичную версию.',
          'Публикация делает текущую сборку основной для пользователей. После публикации публичная страница приложения должна открывать именно этот шаблон.',
          'Если в карточке написано «Опубликован», но публичная версия всё равно показывает, что калькулятор не опубликован, обычно проблема в том, что данные не были синхронизированы как серверный шаблон.',
        ],
      },
      {
        title: 'Что проверять перед публикацией',
        items: [
          'Открывается ли нужный калькулятор по публичной ссылке.',
          'Сохранились ли формула, блок результата, изображения, тексты и обязательные поля.',
          'Уходят ли заявки менеджерам из опубликованной версии, а не только из предпросмотра.',
          'Корректно ли работает сценарий на мобильном экране внутри VK.',
        ],
      },
      {
        title: 'Управление калькуляторами',
        items: [
          'В «Моих калькуляторах» удобно хранить разные сценарии: отдельные продукты, сезонные предложения, разные воронки под рекламу.',
          'Используйте дублирование, если нужно быстро сделать новый вариант на базе готового калькулятора.',
          'Переименовывайте калькуляторы понятно: «Потолки базовый», «Потолки премиум», «Запись на замер», «Калькулятор для рекламы VK».',
        ],
      },
    ],
  },
  {
    id: 'admin-sections',
    title: 'Разделы админки',
    caption: 'Что где находится',
    intro:
      'Левая навигация разделяет весь сервис по задачам. Ниже кратко описано, что делает каждый раздел и когда туда заходить в процессе работы.',
    sections: [
      {
        title: 'Основные разделы',
        items: [
          '«Мои калькуляторы» — главный рабочий раздел. Здесь создаются, открываются, дублируются и публикуются проекты.',
          '«Шаблоны» — библиотека готовых решений. Подходит для быстрого старта, когда не хочется собирать структуру с нуля.',
          '«Аналитика» — статистика по просмотрам, заполнениям и эффективности калькуляторов. Полезна после публикации.',
          '«Интеграции» — подключение внешних сценариев и расширений, если проекту нужна автоматизация.',
        ],
      },
      {
        title: 'Служебные разделы',
        items: [
          '«Платежи» — тариф, статус доступа, оплата и активация расширенных возможностей.',
          '«FAQ» — встроенная справка по конструктору, которую вы сейчас обновляете под реальную работу пользователей.',
          '«Настройки» — служебные данные приложения, включая параметры для менеджеров и сценариев отправки заявок.',
        ],
      },
      {
        title: 'Как использовать это на практике',
        items: [
          'Обычно работа выглядит так: берёте шаблон или создаёте новый проект, собираете калькулятор, тестируете, публикуете, потом отслеживаете результат в аналитике.',
          'Если нужно быстро адаптировать готовый сценарий под другой продукт, лучше дублировать калькулятор, а не переделывать уже опубликованный вариант.',
        ],
      },
    ],
  },
  {
    id: 'library',
    title: 'Библиотека элементов',
    caption: 'Все блоки конструктора',
    intro:
      'Здесь собраны основные элементы, из которых собирается калькулятор. Не обязательно использовать всё сразу: чаще всего хороший экран строится из 5–10 аккуратно настроенных блоков, а не из максимального числа элементов.',
    sections: [
      {
        title: 'Поля выбора',
        items: [
          'Список. Подходит для выбора одного варианта из набора: материал, цвет, тип конструкции, тариф.',
          'Радио или переключатели. Удобны, когда вариантов немного и их важно показать сразу на экране.',
          'Чекбокс или флаг. Используются для дополнительных опций: монтаж, доставка, срочность, подарок, согласие.',
          'Для каждого варианта можно задавать подпись и стоимость. Это удобно, когда выбор сразу влияет на расчёт.',
        ],
      },
      {
        title: 'Числовые элементы',
        items: [
          'Числовое поле подходит для точного ввода значения: ширина, высота, количество, площадь.',
          'Ползунок удобен, когда нужно быстро выбрать значение в диапазоне и показать изменение цены прямо на экране.',
          'Для таких полей всегда настраивайте минимум, максимум, шаг и единицу измерения. Пример: «Ширина, см», от 50 до 400, шаг 5.',
        ],
      },
      {
        title: 'Контактные поля',
        items: [
          'Текст — для имени, города, адреса или короткого ответа.',
          'Телефон — для связи с клиентом. Обычно это обязательное поле.',
          'Email — если нужно отправить предложение или копию расчёта.',
          'Textarea — для комментария, пожеланий и подробностей заказа.',
          'Дата, время или бронирование — если пользователь должен выбрать слот записи.',
        ],
      },
      {
        title: 'Информационные блоки',
        items: [
          'Текстовый блок подходит для заголовков, инструкций, пояснений, предупреждений и рекламных акцентов.',
          'Изображение помогает показать пример изделия, схему замера, референс или этапы работы.',
          'HTML или разметка нужны для нестандартных вставок, баннеров и более сложного оформления.',
        ],
      },
      {
        title: 'Результат и действие',
        items: [
          'Блок результата показывает сумму или промежуточный расчёт. Их может быть несколько, если нужен более детальный вывод.',
          'Карточка результата внизу экрана собирает главное: итог, подсказку и кнопку отправки заявки.',
          'Кнопка завершает сценарий. Её лучше делать максимально понятной: «Отправить заявку», «Получить расчёт», «Заказать замер».',
        ],
      },
      {
        title: 'Готовые примеры сборки',
        items: [
          'Пример «Потолки»: изображение со схемой замера, поля «Ширина» и «Высота», список «Материал», чекбокс «Монтаж», результат снизу, имя, телефон, согласие.',
          'Пример «Москитные сетки»: тип окна, ширина, высота, сетка, ламинация, доставка, комментарий и заявка менеджеру.',
          'Пример «Запись на услугу»: заголовок, описание, дата, время, имя, телефон, комментарий, согласие, кнопка отправки без сложной формулы.',
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
  { key: 'communities', label: 'Мои сообщества', icon: Icon20HomeOutline },
  { key: 'calculators', label: 'Мои калькуляторы', icon: Icon20HomeOutline },
  { key: 'templates', label: 'Шаблоны', icon: Icon20ArticleOutline },
  { key: 'analytics', label: 'Аналитика Pro', icon: Icon20GraphOutline },
  { key: 'integrations', label: 'Интеграции Pro', icon: Icon20ServicesOutline },
  { key: 'requests', label: 'Заявки', icon: Icon20WriteOutline },
  { key: 'payments', label: 'Платежи', icon: Icon20PaymentCardOutline },
  { key: 'faq', label: 'FAQ', icon: Icon20QuestionOutline },
  { key: 'settings', label: 'Настройки', icon: Icon20GearOutline },
];

const tariffOverview = [
  {
    planId: 'free' as const,
    title: 'Free',
    items: ['1 калькулятор', 'до 20 заявок в месяц', 'базовые поля', 'логотип CalcPro'],
  },
  {
    planId: 'start' as const,
    title: 'Start',
    items: ['3 калькулятора', 'до 100 заявок', 'статусы заявок', 'шаблоны'],
  },
  {
    planId: 'pro' as const,
    title: 'Pro',
    items: ['безлимитные калькуляторы', 'сложные формулы', 'уведомления', 'аналитика'],
  },
] satisfies Array<{
  planId: CalculatorSubscriptionPlan;
  title: string;
  items: string[];
}>;

const categoryLabels: Record<'all' | TemplateCatalogCategory, string> = {
  all: 'Все',
  business: 'Бизнес',
  finance: 'Финансы',
  construction: 'Строительство',
  services: 'Услуги',
  other: 'Другое',
};

const visualSymbols: Record<TemplateCatalogPreset['visual'], string> = {
  repair: 'House',
  delivery: 'Box',
  mortgage: 'Home',
  credit: 'Card',
  windows: 'Grid',
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
const paidPlanOrder: CalculatorSubscriptionPlan[] = ['start', 'pro'];

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
  disabled = false,
}: {
  preset: TemplateCatalogPreset;
  onUse: (presetId: string) => void;
  disabled?: boolean;
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

    <button
      className="template-preset__action"
      type="button"
      disabled={disabled}
      onClick={() => onUse(preset.id)}
    >
      {disabled ? 'Доступно в Start' : 'Использовать'}
    </button>
  </article>
);

export const HomePage = ({
  connectedCommunities,
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
  onUpdateRequestStatus,
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
  onTransferTemplateToCommunity,
  onUpdateTemplateStatus,
  onCopyTemplateLink,
  currentPlan,
  configuredPlan,
  hasActiveSubscription,
  isSuperAdmin,
  currentGroupId,
  launchGroupId,
  canCreateMoreTemplates,
  canCreateMoreRequests,
  monthlyRequestsUsed,
  requestLimit,
  canUseTemplates,
  canUseAnalytics,
  canUseNotifications,
  canUseRequestStatuses,
  canUseFolders,
  onSelectAdminGroup,
  onDisconnectCommunity,
  onStartPayment,
  onInstallInCommunity,
  onGrantProAccess,
  isProcessingPayment,
  paymentStatus,
  isDesktopClient,
  isCompactViewport,
  isCommunityContext,
}: HomePageProps) => {
  const isSectionLocked = (section: AdminSection) =>
    (section === 'analytics' && !canUseAnalytics) ||
    (section === 'integrations' && !canUseNotifications) ||
    (section === 'templates' && !canUseTemplates);
  const showCreateCalculatorLimitHint = !canCreateMoreTemplates;

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
  const [superAdminGroupId, setSuperAdminGroupId] = useState(
    currentGroupId > 0 ? String(currentGroupId) : '',
  );
  const [superAdminDays, setSuperAdminDays] = useState('30');
  const [superAdminStatus, setSuperAdminStatus] = useState('');
  const [supportTickets, setSupportTickets] = useState<CalculatorSupportTicket[]>(() =>
    getSupportTickets(),
  );
  const [supportTicketsPage, setSupportTicketsPage] = useState(1);
  const [expandedSupportTicketIds, setExpandedSupportTicketIds] = useState<string[]>([]);
  const [supportType, setSupportType] = useState<CalculatorSupportTicketType>('message');
  const [supportSubject, setSupportSubject] = useState('');
  const [supportMessage, setSupportMessage] = useState('');
  const [supportStatus, setSupportStatus] = useState('');
  const [supportNow, setSupportNow] = useState(() => Date.now());
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
  const loadSupportTicketsFromServer = async (resetPage = false) => {
    try {
      const query = currentGroupId > 0 ? `?groupId=${currentGroupId}` : '';
      const response = await fetch(`/api/support${query}`);
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; data?: CalculatorSupportTicket[] }
        | null;

      if (!response.ok || !payload?.ok || !Array.isArray(payload.data)) {
        return;
      }

      setSupportTickets(replaceSupportTickets(payload.data));
      if (resetPage) {
        setSupportTicketsPage(1);
      }
    } catch {
      // Keep local support tickets when server sync is unavailable.
    }
  };

  useEffect(() => {
    setManagerVkId(adminSettings.managerVkId);
  }, [adminSettings.managerVkId]);

  useEffect(() => {
    void loadSupportTicketsFromServer(true);
  }, [currentGroupId]);

  useEffect(() => {
    if (currentSection !== 'settings') {
      return;
    }

    const intervalId = window.setInterval(() => {
      setSupportNow(Date.now());
      void loadSupportTicketsFromServer(false);
    }, 10000);

    const handleWindowFocus = () => {
      void loadSupportTicketsFromServer(false);
    };

    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleWindowFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleWindowFocus);
    };
  }, [currentSection, currentGroupId]);

  useEffect(() => {
    if (currentSection !== 'settings') {
      return;
    }

    const timerId = window.setInterval(() => {
      setSupportNow(Date.now());
    }, 60000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [currentSection]);

  useEffect(() => {
    setSuperAdminGroupId(currentGroupId > 0 ? String(currentGroupId) : '');
  }, [currentGroupId]);

  useEffect(() => {
    setSupportTickets(getSupportTickets());
    setSupportTicketsPage(1);
    setExpandedSupportTicketIds([]);
  }, [currentGroupId]);

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
  const latestRequests = useMemo(
    () =>
      [...requests]
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        .slice(0, 8),
    [requests],
  );
  const subscriptionPaidUntilLabel = formatSubscriptionDate(adminSettings.subscription.paidUntil);
  const subscriptionDaysLeft = useMemo(() => {
    const paidUntil = parseSubscriptionDate(adminSettings.subscription.paidUntil);
    if (!paidUntil) {
      return 0;
    }

    const diffMs = paidUntil.getTime() - Date.now();
    if (diffMs <= 0) {
      return 0;
    }

    return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }, [adminSettings.subscription.paidUntil]);
  const subscriptionDaysLeftLabel =
    subscriptionDaysLeft > 0
      ? `${subscriptionDaysLeft} дн. осталось`
      : 'Срок не активен';
  const requestQuotaLabel =
    requestLimit == null
      ? 'Безлимит заявок'
      : `${monthlyRequestsUsed} / ${requestLimit} заявок в этом месяце${canCreateMoreRequests ? '' : ' · лимит исчерпан'}`;
  const selectedCommunity =
    connectedCommunities.find((community) => community.groupId === currentGroupId) ?? null;
  const communityLimitLabel =
    currentPlan.communityLimit == null
      ? 'Безлимит сообществ'
      : `${connectedCommunities.length} / ${currentPlan.communityLimit} сообществ`;
  const isCommunityLimitReached =
    currentPlan.communityLimit != null && connectedCommunities.length >= currentPlan.communityLimit;
  const activationSteps = isCommunityContext
    ? [
        'Оплатите доступ через YooKassa на этом экране.',
        'После оплаты укажите VK ID менеджера, который будет получать заявки.',
        'Откройте конструктор, опубликуйте калькулятор и проверьте форму внутри сообщества.',
      ]
    : [
        'Нажмите «Установить в сообщество» и выберите нужную группу VK.',
        'Откройте приложение уже внутри выбранного сообщества.',
        'Оплатите доступ через YooKassa на экране активации.',
        'После открытия админки укажите VK ID менеджера и включите публикацию формы заявки.',
      ];

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

  const renderCommunitiesSection = () => (
    <main className="admin-home__content admin-home__content_wide">
      <div className="admin-home__content-head">
        <div className="admin-home__title-wrap">
          <h1 className="admin-home__title">Мои сообщества</h1>
        </div>
        <div className="admin-home__role-badge">WORKSPACE</div>
      </div>

      <section className="communities-layout">
        <article className="communities-hero">
          <div className="communities-hero__eyebrow">Мультигрупповой кабинет</div>
          <h2 className="communities-hero__title">Один кабинет для разных сообществ</h2>
          <p className="communities-hero__text">
            Переключайте активную группу и работайте с её калькуляторами, заявками и настройками
            в одном интерфейсе. Тариф, лимиты и данные подгружаются для выбранного сообщества.
          </p>
        </article>

        <article className="communities-card">
          <div className="communities-card__head">
            <div>
              <div className="communities-card__eyebrow">Подключённые группы</div>
              <h3 className="communities-card__title">Список сообществ</h3>
            </div>
            <div className="communities-card__head-actions">
              <div className="communities-card__meta">{communityLimitLabel}</div>
              <button
                className="communities-card__add-button"
                type="button"
                onClick={onInstallInCommunity}
                disabled={isCommunityLimitReached}
              >
                Подключить сообщество
              </button>
            </div>
          </div>

          {isCommunityLimitReached ? (
            <div className="communities-card__limit-banner">
              Лимит сообществ для тарифа {currentPlan.name} достигнут. Чтобы подключить ещё одну
              группу, перейдите на более высокий тариф.
            </div>
          ) : null}

          <div className="communities-list">
            {connectedCommunities.length ? (
              connectedCommunities.map((community) => {
                const isActive = community.groupId === currentGroupId;

                return (
                  <button
                    key={community.groupId}
                    className={`community-row ${isActive ? 'community-row_active' : ''}`}
                    type="button"
                    onClick={() => onSelectAdminGroup(community.groupId)}
                  >
                    <div className="community-row__media">
                      {community.photoUrl ? (
                        <img
                          className="community-row__avatar"
                          src={community.photoUrl}
                          alt={community.name}
                        />
                      ) : (
                        <div className="community-row__avatar community-row__avatar_fallback">
                          {community.name.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="community-row__body">
                      <div className="community-row__name">{community.name}</div>
                      <div className="community-row__meta">
                        ID {community.groupId}
                        {community.screenName ? ` · @${community.screenName}` : ''}
                        {community.role ? ` · роль: ${community.role}` : ''}
                      </div>
                    </div>
                    <div className="community-row__side">
                      <span
                        className={`community-row__badge ${isActive ? 'community-row__badge_active' : ''}`}
                      >
                        {isActive ? 'Текущая группа' : 'Сделать активной'}
                      </span>
                      {!isActive ? (
                        <button
                          className="community-row__remove"
                          type="button"
                          aria-label={`Отключить ${community.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onDisconnectCommunity(community.groupId);
                          }}
                        >
                          <Icon20TrashSimpleOutline />
                        </button>
                      ) : null}
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="communities-card__empty">
                Пока нет подключённых сообществ. Откройте приложение внутри нужной группы VK или
                используйте установку через экран оплаты.
              </div>
            )}
          </div>
        </article>

        <article className="communities-card">
          <div className="communities-card__head">
            <div>
              <div className="communities-card__eyebrow">Активный контекст</div>
              <h3 className="communities-card__title">
                {selectedCommunity?.name || (currentGroupId > 0 ? `Сообщество ${currentGroupId}` : 'Группа не выбрана')}
              </h3>
            </div>
          </div>

          <div className="communities-summary">
            <div className="communities-summary__row">
              <span>Рабочая группа</span>
              <strong>{currentGroupId > 0 ? `ID ${currentGroupId}` : 'Не выбрана'}</strong>
            </div>
            <div className="communities-summary__row">
              <span>Контекст запуска</span>
              <strong>{launchGroupId > 0 ? `ID ${launchGroupId}` : 'Вне сообщества'}</strong>
            </div>
            <div className="communities-summary__row">
              <span>Тариф</span>
              <strong>{currentPlan.name}</strong>
            </div>
          </div>
        </article>
      </section>
    </main>
  );

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
              disabled={!canUseFolders}
              onClick={onCreateFolder}
            >
              <Icon20Add />
            </button>
          </div>
          {!canUseFolders ? (
            <div className="create-calculator-tile__tooltip">
              Папки доступны на тарифах Start и Pro.
            </div>
          ) : null}

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
                    if (!canUseFolders) {
                      return;
                    }
                    event.stopPropagation();
                    setEditingFolderId(folder.id);
                    setDraftFolderName(folder.name);
                  }}
                  onKeyDown={(event) => {
                    if (!canUseFolders) {
                      return;
                    }
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
                    if (!canUseFolders) {
                      return;
                    }
                    event.stopPropagation();
                    setPendingDeleteFolder(folder);
                  }}
                  onKeyDown={(event) => {
                    if (!canUseFolders) {
                      return;
                    }
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
                {currentPlan.calculatorLimit == null
                  ? 'Лимит по калькуляторам снят.'
                  : `${currentPlan.name}: до ${currentPlan.calculatorLimit} калькуляторов`}
              </div>
            ) : null}
          </div>

          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              folders={folders}
              communities={connectedCommunities}
              currentGroupId={currentGroupId}
              canDuplicate={canUseTemplates}
              canUseFolders={canUseFolders}
              onOpen={onOpen}
              onEdit={onEdit}
              onDuplicate={onDuplicateTemplate}
              onDelete={setPendingDeleteTemplate}
              onMoveToFolder={onMoveTemplateToFolder}
              onTransferToCommunity={onTransferTemplateToCommunity}
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
            <TemplatePresetCard
              key={preset.id}
              preset={preset}
              onUse={onUsePreset}
              disabled={!canUseTemplates}
            />
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
          <h1 className="admin-home__title">Платежи и активация</h1>
        </div>
        <div className="admin-home__role-badge">Подписка</div>
      </div>

      <section className="payments-section">
        <article className="payments-hero">
          <div className="payments-hero__copy">
            <div className="payments-hero__eyebrow">Плагин для сообщества</div>
            <h2 className="payments-hero__title">CalcPro</h2>
            <p className="payments-hero__text">
              Приложение работает как инструмент внутри сообщества VK: помогает принимать заявки,
              показывать предварительный расчёт и передавать обращения менеджеру.
            </p>

            <div className="payments-activation-card">
              <div className="payments-activation-card__copy">
                <div className="payments-activation-card__title">
                  {isCommunityContext
                    ? 'Приложение открыто внутри сообщества'
                    : 'Подключение и активация приложения'}
                </div>
                <p className="payments-activation-card__text">
                  {isCommunityContext
                    ? 'Теперь можно оплатить доступ, завершить настройку и опубликовать форму для посетителей сообщества.'
                    : 'Сейчас приложение запущено вне контекста сообщества. Чтобы посетители могли оставлять заявки, а администраторы управлять настройками, подключите его к нужной группе и завершите активацию по инструкции ниже.'}
                </p>
              </div>
              <button
                className="payments-activation-card__button"
                type="button"
                onClick={onInstallInCommunity}
              >
                Установить в сообщество
              </button>
            </div>

            <div className="payments-activation-banner">
              {isCommunityContext
                ? 'Приложение уже открыто в группе VK. Теперь оплатите доступ и завершите настройку админки.'
                : 'После подключения откройте приложение в вашей группе VK.'}
            </div>
          </div>

          <div className="payments-price-card">
            <div className="payments-price-card__label">Текущий тариф</div>
            <div className="payments-price-card__value">{currentPlan.name}</div>
            <div className="payments-price-card__caption">{requestQuotaLabel}</div>
            <div className="payments-price-card__plans">
              {tariffOverview.map((plan) => {
                const planConfig = SUBSCRIPTION_PLANS[plan.planId];
                const isActivePlan = currentPlan.id === plan.planId;

                return (
                  <div
                    key={plan.planId}
                    className={`payments-plan-info ${isActivePlan ? 'payments-plan-info_active' : ''}`}
                  >
                    <div className="payments-plan-info__head">
                      <div className="payments-plan-info__name">{plan.title}</div>
                      <div className="payments-plan-info__price">
                        {planConfig.monthlyPriceRub > 0
                          ? `${formatCurrency(planConfig.monthlyPriceRub)}/мес`
                          : 'бесплатно'}
                      </div>
                    </div>
                    <div className="payments-plan-info__items">
                      {plan.items.map((item) => (
                        <div key={item} className="payments-plan-info__item">
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            {paidPlanOrder.map((planId) => {
              const plan = SUBSCRIPTION_PLANS[planId];
              const isCurrentConfiguredPlan = configuredPlan.id === plan.id;

              return (
                <button
                  key={plan.id}
                  className="payments-price-card__button"
                  type="button"
                  onClick={() => onStartPayment(plan.id)}
                  disabled={isProcessingPayment}
                >
                  {isProcessingPayment
                    ? 'Переходим к оплате...'
                    : `${isCurrentConfiguredPlan && hasActiveSubscription ? 'Продлить' : 'Выбрать'} ${plan.name} за ${formatCurrency(plan.monthlyPriceRub)}`}
                </button>
              );
            })}
            <div className="payments-price-card__meta-row">
              <div className="payments-price-card__meta-label">Статус</div>
              <div className="payments-price-card__meta-value">
                {hasActiveSubscription && currentPlan.id !== 'free' ? 'Подписка активна' : 'Бесплатный тариф'}
              </div>
            </div>
            <div className="payments-price-card__meta-row">
              <div className="payments-price-card__meta-label">План</div>
              <div className="payments-price-card__meta-value">
                {currentPlan.name}
              </div>
            </div>
            <div className="payments-price-card__meta-row">
              <div className="payments-price-card__meta-label">Доступ</div>
              <div className="payments-price-card__meta-value">
                {subscriptionPaidUntilLabel && currentPlan.id !== 'free'
                  ? `до ${subscriptionPaidUntilLabel}`
                  : 'включён сразу'}
              </div>
            </div>
            <div className="payments-price-card__meta-row">
              <div className="payments-price-card__meta-label">Уведомления</div>
              <div className="payments-price-card__meta-value">
                {canUseNotifications ? 'Включены' : 'Доступны только на Pro'}
              </div>
            </div>
            {paymentStatus ? (
              <div className={`payments-price-card__status payments-price-card__status_${paymentStatus.tone}`}>
                {paymentStatus.message}
              </div>
            ) : null}
          </div>
        </article>

        <div className="payments-scenarios">
          <article className="payments-scenario-card">
            <div className="payments-scenario-card__head">
              <div className="payments-scenario-card__index">01</div>
              <div className="payments-scenario-card__caption">Сценарий для посетителя</div>
            </div>
            <div className="payments-scenario-card__content">
              <h3 className="payments-scenario-card__title">Что делает плагин</h3>
              <p className="payments-scenario-card__text">
                Посетитель открывает калькулятор внутри сообщества, оставляет параметры расчёта и
                отправляет заявку прямо из сообщества.
              </p>
            </div>
          </article>

          <article className="payments-scenario-card">
            <div className="payments-scenario-card__head">
              <div className="payments-scenario-card__index">02</div>
              <div className="payments-scenario-card__caption">Сценарий для администратора</div>
            </div>
            <div className="payments-scenario-card__content">
              <h3 className="payments-scenario-card__title">Что получает администратор</h3>
              <p className="payments-scenario-card__text">
                Админ-панель с настройкой цен, шаблонов, публикацией формы и обработкой заявок для
                конкретного сообщества.
              </p>
            </div>
          </article>

          <article className="payments-scenario-card">
            <div className="payments-scenario-card__head">
              <div className="payments-scenario-card__index">03</div>
              <div className="payments-scenario-card__caption">Запуск в VK</div>
            </div>
            <div className="payments-scenario-card__content">
              <h3 className="payments-scenario-card__title">Как установить</h3>
              <p className="payments-scenario-card__text">
                Нажмите кнопку установки, выберите сообщество VK, откройте приложение внутри него и
                завершите настройку после оплаты.
              </p>
            </div>
          </article>
        </div>

        <article className="payments-guide">
          <div className="payments-guide__copy">
            <div className="payments-guide__eyebrow">Инструкция по активации</div>
            <h3 className="payments-guide__title">
              {isCommunityContext ? 'Как завершить активацию CalcPro' : 'Как запустить CalcPro в сообществе VK'}
            </h3>
            <p className="payments-guide__text">
              {isCommunityContext
                ? 'Вы уже внутри сообщества. Осталось оплатить доступ, указать менеджера для заявок и опубликовать калькулятор для посетителей.'
                : 'После установки откройте приложение внутри выбранного сообщества и завершите настройку. После оплаты откроется админка, где можно указать получателя заявок и опубликовать форму для посетителей.'}
            </p>
          </div>

          <ol className="payments-guide__steps">
            {activationSteps.map((step, index) => (
              <li key={step} className="payments-guide__step">
                <span className="payments-guide__step-index">{index + 1}</span>
                <span className="payments-guide__step-text">{step}</span>
              </li>
            ))}
          </ol>
        </article>
      </section>
    </main>
  );

  const handleSupportSubmit = async () => {
    const subject = supportSubject.trim();
    const message = supportMessage.trim();

    if (!subject || !message) {
      setSupportStatus('Заполните тему и сообщение.');
      return;
    }

    const ticket: CalculatorSupportTicket = {
      id: `support-${Date.now()}`,
      type: supportType,
      status: 'pending',
      subject,
      message,
      managerComment: '',
      createdAt: new Date().toISOString(),
      authorLabel: currentAdminLabel,
      authorVkId: adminProfile.id,
    };

    const nextTickets = addSupportTicket(ticket);
    setSupportTickets(nextTickets);
    setSupportTicketsPage(1);
    setSupportSubject('');
    setSupportMessage('');
    setSupportType('message');

    try {
      const response = await fetch('/api/support', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...ticket,
          groupId: currentGroupId,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; message?: string; data?: CalculatorSupportTicket[] }
        | null;

      if (response.ok && payload?.ok) {
        if (Array.isArray(payload.data)) {
          setSupportTickets(replaceSupportTickets(payload.data));
        }
        setSupportStatus(payload.message || 'Обращение отправлено в саппорт.');
        return;
      }
    } catch {
      // Keep the local ticket as a fallback if VK delivery is unavailable.
    }

    setSupportStatus('Обращение сохранено локально. Отправка в саппорт сейчас недоступна.');
  };

  const toggleSupportTicketExpanded = (ticketId: string) => {
    setExpandedSupportTicketIds((current) =>
      current.includes(ticketId)
        ? current.filter((id) => id !== ticketId)
        : [...current, ticketId],
    );
  };

  const handleSupportStatusChange = (
    ticketId: string,
    status: CalculatorSupportTicketStatus,
  ) => {
    const nextTickets = updateSupportTicketStatus(ticketId, status);
    setSupportTickets(nextTickets);

    void (async () => {
      try {
        const response = await fetch(`/api/support?action=status`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ticketId,
            status,
            groupId: currentGroupId,
          }),
        });
        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; data?: CalculatorSupportTicket[] }
          | null;

        if (response.ok && payload?.ok && Array.isArray(payload.data)) {
          setSupportTickets(replaceSupportTickets(payload.data));
        }
      } catch {
        // Keep the local status if server sync is temporarily unavailable.
      }
    })();
  };

  const handleSupportCommentChange = (ticketId: string, managerComment: string) => {
    setSupportTickets(updateSupportTicketComment(ticketId, managerComment));

    void (async () => {
      try {
        const response = await fetch(`/api/support?action=comment`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ticketId,
            managerComment,
            groupId: currentGroupId,
          }),
        });
        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; data?: CalculatorSupportTicket[] }
          | null;

        if (response.ok && payload?.ok && Array.isArray(payload.data)) {
          setSupportTickets(replaceSupportTickets(payload.data));
        }
      } catch {
        // Keep the local comment if server sync is temporarily unavailable.
      }
    })();
  };

  const handleGrantProSubmit = async () => {
    const targetGroupId = Number(superAdminGroupId);
    const days = Math.max(1, Number(superAdminDays) || 30);

    if (!Number.isInteger(targetGroupId) || targetGroupId <= 0) {
      setSuperAdminStatus('Укажите корректный ID группы VK.');
      return;
    }

    const result = await onGrantProAccess(targetGroupId, days);
    setSuperAdminStatus(result.message);
  };

  const renderRequestsSection = () => (
    <main className="admin-home__content admin-home__content_wide">
      <div className="admin-home__content-head">
        <div className="admin-home__title-wrap">
          <h1 className="admin-home__title">Заявки</h1>
        </div>
      </div>

      <section className="settings-section">
        <article className="settings-card settings-card_requests">
          <div className="settings-card__eyebrow">Заявки</div>
          <h2 className="settings-card__title">Статусы и обработка обращений</h2>
          <p className="settings-card__text">
            На тарифах Start и Pro можно отмечать новые, активные и закрытые заявки, чтобы не
            терять обработку лидов.
          </p>

          {!canUseRequestStatuses ? (
            <div className="settings-form__hint">
              Статусы заявок доступны на тарифах Start и Pro.
            </div>
          ) : latestRequests.length === 0 ? (
            <div className="settings-form__hint">
              Пока нет заявок, которые можно разобрать по статусам.
            </div>
          ) : (
            <div className="settings-support__tickets">
              {latestRequests.map((request) => (
                <div key={request.id} className="settings-support__ticket">
                  <div className="settings-support__ticket-head">
                    <div className="settings-support__ticket-head-main">
                      <strong>{request.templateTitle}</strong>
                      <span
                        className={`settings-support__status settings-support__status_${request.status === 'done' ? 'reviewed' : request.status === 'rejected' ? 'rejected' : 'pending'}`}
                      >
                        {requestStatusLabels[request.status]}
                      </span>
                    </div>
                    <span>
                      {new Date(request.createdAt).toLocaleDateString('ru-RU')}{' '}
                      {new Date(request.createdAt).toLocaleTimeString('ru-RU', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="settings-support__note">
                    {request.name} · {request.phone}
                  </div>
                  <div className="settings-support__note">
                    Сумма: {formatCurrency(request.amount)}
                  </div>
                  {request.comment ? (
                    <div className="settings-support__ticket-message settings-support__ticket-message_expanded">
                      {request.comment}
                    </div>
                  ) : null}
                  <label className="settings-support__status-control">
                    <span className="settings-support__label">Статус</span>
                    <select
                      className="settings-support__input"
                      value={request.status}
                      onChange={(event) =>
                        onUpdateRequestStatus(request.id, event.target.value as CalculatorRequestStatus)
                      }
                    >
                      <option value="new">Новая</option>
                      <option value="in_progress">В работе</option>
                      <option value="done">Закрыта</option>
                      <option value="rejected">Отклонена</option>
                    </select>
                  </label>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
    </main>
  );

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
              inputMode="text"
              placeholder="Например: 123456789"
              value={managerVkId}
              disabled={!canUseNotifications}
              onChange={(event) => setManagerVkId(event.target.value.replace(/[^\d,\s;-]/g, ''))}
            />
          </label>

          <div className="settings-form__hint">
            {canUseNotifications
              ? 'Укажите VK ID сотрудника, которому будут приходить заявки из калькуляторов.'
              : 'Отправка заявок менеджерам доступна на тарифе Про.'}
          </div>

          <button
            className="settings-form__button"
            type="button"
            disabled={!canUseNotifications}
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

        {isSuperAdmin ? (
          <article className="settings-card">
            <div className="settings-card__eyebrow">Супер-админ</div>
            <h2 className="settings-card__title">Ручная выдача тарифа Про</h2>
            <p className="settings-card__text">
              Здесь можно вручную открыть доступ Про для любой группы VK по её ID. Блок виден
              только вашему аккаунту.
            </p>

            <label className="settings-form__field">
              <span className="settings-form__label">ID группы</span>
              <input
                className="settings-form__input"
                type="text"
                inputMode="numeric"
                placeholder="Например: 22702487"
                value={superAdminGroupId}
                onChange={(event) => setSuperAdminGroupId(event.target.value.replace(/[^\d]/g, ''))}
              />
            </label>

            <label className="settings-form__field">
              <span className="settings-form__label">Срок доступа, дней</span>
              <input
                className="settings-form__input"
                type="text"
                inputMode="numeric"
                placeholder="30"
                value={superAdminDays}
                onChange={(event) => setSuperAdminDays(event.target.value.replace(/[^\d]/g, ''))}
              />
            </label>

            <div className="settings-form__hint">
              {currentGroupId > 0
                ? `Текущая группа: ${currentGroupId}. Можно выдать Про ей или ввести другой ID.`
                : 'Откройте приложение внутри сообщества или введите ID группы вручную.'}
            </div>
            {superAdminStatus ? <div className="settings-form__hint">{superAdminStatus}</div> : null}

            <button className="settings-form__button" type="button" onClick={handleGrantProSubmit}>
              Выдать Про группе
            </button>
          </article>
        ) : null}

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
              <div className="settings-support__note">
                {supportStatus || 'Обращение сохранится локально в этом проекте.'}
              </div>
            </div>

            <div className="settings-support__actions">
              <div className="settings-support__panel-title">Последние обращения</div>
              <div className="settings-support__tickets">
                {supportVisibleTickets.map((ticket) => {
                  const isExpanded = expandedSupportTicketIds.includes(ticket.id);

                  return (
                  <div key={ticket.id} className="settings-support__ticket">
                    <div className="settings-support__ticket-head">
                      <div className="settings-support__ticket-head-main">
                        <strong>{supportTypeLabels[ticket.type]}</strong>
                        <span
                          className={`settings-support__status settings-support__status_${ticket.status}`}
                        >
                          {supportStatusLabels[ticket.status]}
                        </span>
                      </div>
                      <span>
                        {new Date(ticket.createdAt).toLocaleDateString('ru-RU')}{' '}
                        {new Date(ticket.createdAt).toLocaleTimeString('ru-RU', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <div className="settings-support__note">Автор: {ticket.authorLabel}</div>
                    <div className="settings-support__note">
                      {formatSupportCountdown(ticket.createdAt, supportNow)}
                    </div>
                    <label className="settings-support__status-control">
                      <span className="settings-support__label">Статус</span>
                      <select
                        className="settings-support__input"
                        value={ticket.status}
                        onChange={(event) =>
                          handleSupportStatusChange(
                            ticket.id,
                            event.target.value as CalculatorSupportTicketStatus,
                          )
                        }
                      >
                        <option value="pending">На рассмотрении</option>
                        <option value="reviewed">Рассмотрено</option>
                        <option value="rejected">Отклонено</option>
                      </select>
                    </label>
                    <label className="settings-support__status-control">
                      <span className="settings-support__label">Комментарий</span>
                      <textarea
                        className="settings-support__textarea settings-support__textarea_compact"
                        placeholder="Короткий комментарий по обращению"
                        value={ticket.managerComment ?? ''}
                        maxLength={SUPPORT_COMMENT_MAX_LENGTH}
                        onChange={(event) =>
                          handleSupportCommentChange(
                            ticket.id,
                            event.target.value.slice(0, SUPPORT_COMMENT_MAX_LENGTH),
                          )
                        }
                      />
                      <span className="settings-support__counter">
                        {(ticket.managerComment ?? '').length}/{SUPPORT_COMMENT_MAX_LENGTH}
                      </span>
                    </label>
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
        <div className="admin-placeholder__eyebrow">Доступно на платном тарифе</div>
        <h2 className="admin-placeholder__title">{feature} откроется после апгрейда</h2>
        <p className="admin-placeholder__text">
          Бесплатный тариф подходит для быстрого старта. Перейдите на Start или Pro, чтобы
          расширить лимиты и открыть дополнительные возможности.
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

        <div className="admin-nav__community-switcher">
          <div className="admin-nav__community-label">Активная группа</div>
          <select
            className="admin-nav__community-select"
            value={currentGroupId > 0 ? String(currentGroupId) : ''}
            onChange={(event) => {
              const nextGroupId = Number(event.target.value) || 0;
              if (nextGroupId > 0) {
                onSelectAdminGroup(nextGroupId);
              }
            }}
          >
            {connectedCommunities.length ? (
              connectedCommunities.map((community) => (
                <option key={community.groupId} value={community.groupId}>
                  {community.name} · ID {community.groupId}
                </option>
              ))
            ) : (
              <option value="">Нет подключённых групп</option>
            )}
          </select>
          <button
            className="admin-nav__community-manage"
            type="button"
            onClick={() => handleSectionSelect('communities')}
          >
            Управлять сообществами
          </button>
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
                  {currentPlan.name}
                </div>
              </div>
              <span className="admin-nav__plan-icon">
                {currentPlan.id !== 'free' ? <Icon20CrownVerified /> : <Icon20WalletOutline />}
              </span>
            </div>
            <div className="admin-nav__plan-usage">{requestQuotaLabel}</div>
            {isDesktopClient && !isCompactViewport ? (
              hasActiveSubscription && currentPlan.id !== 'free' ? (
                <div className="admin-nav__plan-meta">{subscriptionDaysLeftLabel}</div>
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
                {hasActiveSubscription && currentPlan.id !== 'free' ? subscriptionDaysLeftLabel : currentPlan.name}
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

      {currentSection === 'communities'
        ? renderCommunitiesSection()
        : currentSection === 'calculators'
        ? renderCalculatorsSection()
        : currentSection === 'analytics'
          ? canUseAnalytics
            ? renderAnalyticsSection()
            : renderPlanLockedSection('Аналитика', 'Аналитика')
        : currentSection === 'integrations'
          ? canUseNotifications
            ? renderPlaceholderSection()
            : renderPlanLockedSection('Интеграции', 'Интеграции')
        : currentSection === 'requests'
          ? renderRequestsSection()
        : currentSection === 'payments'
          ? renderPaymentsSection()
        : currentSection === 'settings'
          ? renderSettingsSection()
        : currentSection === 'templates'
          ? canUseTemplates
            ? renderTemplatesSection()
            : renderPlanLockedSection('Шаблоны', 'Каталог шаблонов')
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

