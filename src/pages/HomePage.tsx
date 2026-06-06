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
import type {
  CalculatorAdminSettings,
  CalculatorFolder,
  CalculatorRequest,
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
}

type AnalyticsRange = 7 | 30 | 90 | 365;

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
const hasActiveSubscription = false;

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
}: HomePageProps) => {
  const handleSectionSelect = (section: AdminSection) => {
    onSectionChange(section);
    onToggleAdminNav();
  };

  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [draftFolderName, setDraftFolderName] = useState('');
  const [pendingDeleteFolder, setPendingDeleteFolder] = useState<CalculatorFolder | null>(null);
  const [pendingDeleteTemplate, setPendingDeleteTemplate] = useState<CalculatorTemplate | null>(
    null,
  );
  const [managerVkId, setManagerVkId] = useState(adminSettings.managerVkId);
  const [analyticsRange, setAnalyticsRange] = useState<AnalyticsRange>(30);
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateCategory, setTemplateCategory] = useState<'all' | TemplateCatalogCategory>('all');
  const inputRef = useRef<HTMLInputElement | null>(null);

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
    if (editingFolderId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingFolderId]);

  const activeFolderName =
    activeFolderId === 'all'
      ? 'Все'
      : folders.find((folder) => folder.id === activeFolderId)?.name ?? 'Все';

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
          <button className="create-calculator-tile" type="button" onClick={onCreate}>
            <span className="create-calculator-tile__plus">
              <Icon20Add />
            </span>
            <span className="create-calculator-tile__label">Создать калькулятор</span>
          </button>

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
          <button className="templates-hub__ghost-action" type="button" onClick={onCreate}>
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

          <button className="template-preset template-preset_blank" type="button" onClick={onCreate}>
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
            <button className="payments-price-card__button" type="button">
              Оплатить
            </button>
          </div>
        </article>

        <div className="payments-grid">
          <article className="payments-card">
            <div className="payments-card__eyebrow">Текущий план</div>
            <h3 className="payments-card__title">Про</h3>
            <p className="payments-card__text">
              Активная подписка на сервис с ежемесячным списанием {formatCurrency(monthlyServicePrice)}.
            </p>
            {hasActiveSubscription ? (
              <div className="payments-card__meta">Следующий платеж: 12.06.2026</div>
            ) : null}
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
            onClick={() => onSaveAdminSettings({ managerVkId: managerVkId.trim() })}
          >
            Сохранить
          </button>
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
          {navItems.map((item) => {
            const Icon = item.icon;

            return (
              <button
                key={item.key}
                className={`admin-nav__item ${currentSection === item.key ? 'admin-nav__item_active' : ''}`}
                type="button"
                onClick={() => handleSectionSelect(item.key)}
              >
                <span className="admin-nav__item-icon">
                  <Icon />
                </span>
                <span className="admin-nav__item-label">{item.label}</span>
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
            {hasActiveSubscription ? (
              <div className="admin-nav__plan-meta">Активен до 12.05.2026</div>
            ) : (
              <button
                className="admin-nav__plan-button"
                type="button"
                onClick={() => handleSectionSelect('payments')}
              >
                Перейти к оплате
              </button>
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
          ? renderAnalyticsSection()
        : currentSection === 'payments'
          ? renderPaymentsSection()
        : currentSection === 'settings'
          ? renderSettingsSection()
        : currentSection === 'templates'
          ? renderTemplatesSection()
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
