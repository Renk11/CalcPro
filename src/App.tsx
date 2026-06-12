import { useEffect, useMemo, useState } from 'react';
import bridge, {
  parseURLSearchParamsForGetLaunchParams,
  type GetLaunchParamsResponse,
} from '@vkontakte/vk-bridge';
import { Panel, SplitCol, SplitLayout, View } from '@vkontakte/vkui';
import {
  clampFolderName,
  clampTemplateDescription,
  clampTemplateTitle,
  createEmptyTemplate,
  createTemplatePublicId,
  MAX_TEMPLATE_TITLE_LENGTH,
} from './entities/calculator/model';
import { createTemplateFromPreset } from './entities/calculator/templateCatalog';
import { BuilderPage } from './pages/BuilderPage';
import { CalculatorPage } from './pages/CalculatorPage';
import { HomePage } from './pages/HomePage';
import {
  getAdminSettings,
  getFolders,
  getRequests,
  getTemplates,
  normalizeTemplateRecord,
  saveAdminSettings,
  saveFolders,
  saveTemplates,
  setStorageGroupScope,
  upsertFolder,
  upsertTemplate,
} from './shared/storage/localStorage';
import {
  buildNextPaidUntil,
  createDefaultSubscriptionSettings,
  isSubscriptionActive,
  PENDING_YOOKASSA_PAYMENT_KEY,
} from './shared/subscription';
import type {
  CalculatorPublicationStatus,
  CalculatorAdminSettings,
  CalculatorFolder,
  CalculatorRequest,
  CalculatorTemplate,
} from './shared/types/calculator';

type AppView = 'home' | 'builder' | 'calculator';
type ActiveFolderId = 'all' | string;

export type AdminSection =
  | 'calculators'
  | 'templates'
  | 'analytics'
  | 'integrations'
  | 'payments'
  | 'faq'
  | 'settings';

export interface AdminProfile {
  id?: number;
  firstName: string;
  lastName: string;
  nickname: string;
  photoUrl?: string;
}

const FALLBACK_PROFILE: AdminProfile = {
  firstName: 'Админ',
  lastName: 'сообщества',
  nickname: '@vk_calc_admin',
};

const getProfileLabel = (profile: AdminProfile) =>
  [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim() ||
  profile.nickname ||
  'Администратор';

const getPublicCalculatorUrl = (publicId: string) => {
  if (typeof window === 'undefined') {
    return `?calculator=${publicId}`;
  }

  const url = new URL(window.location.href);
  url.searchParams.set('calculator', publicId);
  return url.toString();
};
const BASIC_TEMPLATE_LIMIT = 1;
const SUPER_ADMIN_IDS = new Set([139346496]);

type PaymentStatusTone = 'neutral' | 'success' | 'error';

type PaymentStatus = {
  tone: PaymentStatusTone;
  message: string;
};

const COMMUNITY_ADMIN_ROLES = new Set(['admin', 'editor', 'moder']);

const parsePositiveInteger = (rawValue: string | null | undefined) => {
  const value = Number(rawValue);
  return Number.isInteger(value) && value > 0 ? value : 0;
};

const getFallbackGroupIdFromLocation = () => {
  if (typeof window === 'undefined') {
    return 0;
  }

  const searchParams = new URLSearchParams(window.location.search);
  const directGroupId =
    parsePositiveInteger(searchParams.get('vk_group_id')) ||
    parsePositiveInteger(searchParams.get('group_id'));
  if (directGroupId > 0) {
    return directGroupId;
  }

  const ownerId = Number(searchParams.get('owner_id') || 0);
  if (Number.isInteger(ownerId) && ownerId < 0) {
    return Math.abs(ownerId);
  }

  const pathnameMatch = window.location.pathname.match(/\/app\d+_-([1-9]\d*)/i);
  if (pathnameMatch) {
    return Number(pathnameMatch[1]);
  }

  return 0;
};

const App = () => {
  const [activeView, setActiveView] = useState<AppView>('calculator');
  const [templates, setTemplates] = useState<CalculatorTemplate[]>(() => getTemplates());
  const [folders, setFolders] = useState<CalculatorFolder[]>(() => getFolders());
  const [requests, setRequests] = useState<CalculatorRequest[]>(() => getRequests());
  const [adminSettings, setAdminSettings] = useState<CalculatorAdminSettings>(() =>
    getAdminSettings(),
  );
  const [selectedTemplate, setSelectedTemplate] = useState<CalculatorTemplate | undefined>();
  const [activeFolderId, setActiveFolderId] = useState<ActiveFolderId>('all');
  const [adminProfile, setAdminProfile] = useState<AdminProfile>(FALLBACK_PROFILE);
  const [isAdminNavOpen, setIsAdminNavOpen] = useState(false);
  const [homeSection, setHomeSection] = useState<AdminSection>('calculators');
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | null>(null);
  const [isDesktopClient, setIsDesktopClient] = useState(true);
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const [launchParams, setLaunchParams] = useState<Partial<GetLaunchParamsResponse> | null>(() => {
    if (typeof window === 'undefined') {
      return null;
    }

    try {
      return parseURLSearchParamsForGetLaunchParams(window.location.search);
    } catch {
      return null;
    }
  });
  const hasActiveSubscription = useMemo(
    () => isSubscriptionActive(adminSettings.subscription),
    [adminSettings.subscription],
  );
  const canCreateMoreTemplates = hasActiveSubscription || templates.length < BASIC_TEMPLATE_LIMIT;
  const fallbackGroupId = getFallbackGroupIdFromLocation();
  const currentGroupId = Number(launchParams?.vk_group_id ?? 0) || fallbackGroupId;
  const viewerGroupRole = launchParams?.vk_viewer_group_role ?? 'none';
  const isViewerGroupAdmin = COMMUNITY_ADMIN_ROLES.has(viewerGroupRole);
  const isSuperAdmin = Boolean(adminProfile.id && SUPER_ADMIN_IDS.has(adminProfile.id));

  useEffect(() => {
    setStorageGroupScope(currentGroupId);
    setTemplates(getTemplates());
    setFolders(getFolders());
    setRequests(getRequests());
    setAdminSettings(getAdminSettings());
    setSelectedTemplate(undefined);
    setActiveFolderId('all');
  }, [currentGroupId]);

  useEffect(() => {
    bridge
      .send('VKWebAppGetUserInfo')
      .then((user) => {
        setAdminProfile({
          id: user.id,
          firstName: user.first_name || FALLBACK_PROFILE.firstName,
          lastName: user.last_name || FALLBACK_PROFILE.lastName,
          nickname: `id${user.id}`,
          photoUrl: user.photo_200 || user.photo_100,
        });
      })
      .catch(() => {
        setAdminProfile(FALLBACK_PROFILE);
      });
  }, []);

  useEffect(() => {
    bridge
      .send('VKWebAppGetLaunchParams')
      .then((params) => {
        setLaunchParams(params);
      })
      .catch(() => {
        setLaunchParams(null);
      });
  }, []);

  useEffect(() => {
    setIsDesktopClient(!bridge.isWebView());
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const mediaQuery = window.matchMedia('(max-width: 1100px)');
    const updateViewportState = () => setIsCompactViewport(mediaQuery.matches);

    updateViewportState();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateViewportState);
      return () => mediaQuery.removeEventListener('change', updateViewportState);
    }

    mediaQuery.addListener(updateViewportState);
    return () => mediaQuery.removeListener(updateViewportState);
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const syncAdminSettings = async () => {
      try {
        const query = currentGroupId > 0 ? `?groupId=${currentGroupId}` : '';
        const response = await fetch(`/api/admin-settings${query}`);
        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; data?: CalculatorAdminSettings }
          | null;

        if (!response.ok || !payload?.ok || !payload.data || isCancelled) {
          return;
        }

        saveAdminSettings(payload.data);
        setAdminSettings(payload.data);
      } catch {
        // Keep local settings as a fallback when API is unavailable.
      }
    };

    syncAdminSettings();

    return () => {
      isCancelled = true;
    };
  }, [currentGroupId]);

  useEffect(() => {
    let isCancelled = false;

    const syncTemplatesFromServer = async () => {
      try {
        const query = currentGroupId > 0 ? `?groupId=${currentGroupId}` : '';
        const response = await fetch(`/api/templates${query}`);
        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; data?: CalculatorTemplate[] }
          | null;

        if (!response.ok || !payload?.ok || !Array.isArray(payload.data) || isCancelled) {
          return;
        }

        const nextTemplates = payload.data.map((template) => normalizeTemplateRecord(template));
        const didMigrateServerTemplates =
          JSON.stringify(nextTemplates) !== JSON.stringify(payload.data);
        saveTemplates(nextTemplates);
        setTemplates(nextTemplates);
        setSelectedTemplate((current) =>
          current ? nextTemplates.find((template) => template.id === current.id) ?? current : current,
        );

        if (didMigrateServerTemplates) {
          fetch(`/api/templates${query}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              groupId: currentGroupId,
              templates: nextTemplates,
            }),
          }).catch(() => {
            // Keep migrated templates locally even if the server update fails.
          });
        }
      } catch {
        // Keep local templates as a fallback when API is unavailable.
      }
    };

    syncTemplatesFromServer();

    return () => {
      isCancelled = true;
    };
  }, [currentGroupId]);

  const sortedTemplates = useMemo(
    () =>
      [...templates].sort(
        (left, right) =>
          new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      ),
    [templates],
  );

  const visibleTemplates = useMemo(() => {
    if (activeFolderId === 'all') {
      return sortedTemplates;
    }

    return sortedTemplates.filter((template) => template.folderId === activeFolderId);
  }, [activeFolderId, sortedTemplates]);

  const currentAdminLabel = useMemo(() => getProfileLabel(adminProfile), [adminProfile]);
  const latestPublishedTemplate = useMemo(
    () => sortedTemplates.find((template) => template.publicationStatus === 'published'),
    [sortedTemplates],
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (
      activeView === 'builder' ||
      (activeView === 'calculator' &&
        selectedTemplate != null &&
        selectedTemplate.publicationStatus !== 'published')
    ) {
      return;
    }

    const publicId = new URLSearchParams(window.location.search).get('calculator');
    const publishedTemplateFromUrl = templates.find(
      (template) => template.publicId === publicId && template.publicationStatus === 'published',
    );
    const nextPublicTemplate = publishedTemplateFromUrl ?? latestPublishedTemplate;

    if (nextPublicTemplate) {
      setSelectedTemplate((current) =>
        current?.id === nextPublicTemplate.id ? current : nextPublicTemplate,
      );

      if (!(isViewerGroupAdmin && activeView === 'home')) {
        setActiveView('calculator');
      }

      return;
    }

    if (!isViewerGroupAdmin) {
      setSelectedTemplate(undefined);
      setActiveView('calculator');
    }
  }, [activeView, isViewerGroupAdmin, latestPublishedTemplate, selectedTemplate, templates]);

  useEffect(() => {
    if (!isViewerGroupAdmin && activeView === 'home') {
      setActiveView('calculator');
    }
  }, [activeView, isViewerGroupAdmin]);

  const openBuilder = (template?: CalculatorTemplate) => {
    if (!isViewerGroupAdmin) {
      return;
    }

    setSelectedTemplate(template);
    setActiveView('builder');
  };

  const createTemplateInActiveFolder = () => {
    if (!isViewerGroupAdmin) {
      return;
    }

    if (!canCreateMoreTemplates) {
      setHomeSection('payments');
      setActiveView('home');
      return;
    }

    const nextTemplate = normalizeTemplateRecord({
      ...createEmptyTemplate(activeFolderId === 'all' ? undefined : activeFolderId),
      lastModifiedBy: currentAdminLabel,
    });
    setSelectedTemplate(nextTemplate);
    setActiveView('builder');
  };

  const createTemplateFromCatalog = (presetId: string) => {
    if (!isViewerGroupAdmin) {
      return;
    }

    if (!hasActiveSubscription) {
      setHomeSection('payments');
      setActiveView('home');
      return;
    }

    if (!canCreateMoreTemplates) {
      setHomeSection('payments');
      setActiveView('home');
      return;
    }

    const nextTemplate = createTemplateFromPreset(
      presetId,
      activeFolderId === 'all' ? undefined : activeFolderId,
    );

    if (!nextTemplate) {
      return;
    }

    setHomeSection('templates');
    setSelectedTemplate(
      normalizeTemplateRecord({
        ...nextTemplate,
        lastModifiedBy: currentAdminLabel,
      }),
    );
    setActiveView('builder');
  };

  const openCalculator = (template: CalculatorTemplate) => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (template.publicationStatus === 'published') {
        url.searchParams.set('calculator', template.publicId);
      } else {
        url.searchParams.delete('calculator');
      }
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
    setSelectedTemplate(template);
    setActiveView('calculator');
  };

  const openAdminHome = () => {
    if (!isViewerGroupAdmin) {
      return;
    }

    setActiveView('home');
  };

  const handleSaveAdminSettings = (settings: CalculatorAdminSettings) => {
    persistAdminSettings(settings);

    const query = currentGroupId > 0 ? `?groupId=${currentGroupId}` : '';

    fetch(`/api/admin-settings${query}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(settings),
    }).catch(() => {
      // Local settings remain saved even if the API request fails.
    });
  };

  const handleGrantProAccess = async (targetGroupId: number, days = 30) => {
    if (!isSuperAdmin || !adminProfile.id || targetGroupId <= 0) {
      return {
        ok: false,
        message: 'Недостаточно прав для выдачи доступа.',
      };
    }

    try {
      const response = await fetch('/api/admin-settings?action=grant-pro', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          viewerId: adminProfile.id,
          targetGroupId,
          days,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; data?: CalculatorAdminSettings; error?: string }
        | null;

      if (!response.ok || !payload?.ok || !payload.data) {
        throw new Error(payload?.error || 'Не удалось выдать доступ Про.');
      }

      if (targetGroupId === currentGroupId) {
        persistAdminSettings(payload.data);
      }

      return {
        ok: true,
        message: `Доступ Про выдан для группы ${targetGroupId}.`,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Не удалось выдать доступ Про.',
      };
    }
  };

  const persistAdminSettings = (settings: CalculatorAdminSettings) => {
    saveAdminSettings(settings);
    setAdminSettings(settings);
  };

  const persistTemplates = (nextTemplates: CalculatorTemplate[]) => {
    saveTemplates(nextTemplates);
    setTemplates(nextTemplates);

    const query = currentGroupId > 0 ? `?groupId=${currentGroupId}` : '';

    fetch(`/api/templates${query}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        groupId: currentGroupId,
        templates: nextTemplates,
      }),
    }).catch(() => {
      // Local templates remain saved even if the API request fails.
    });
  };

  const clearPaymentIdFromUrl = () => {
    if (typeof window === 'undefined') {
      return;
    }

    const url = new URL(window.location.href);
    if (!url.searchParams.has('paymentId')) {
      return;
    }

    url.searchParams.delete('paymentId');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  };

  const openExternalPaymentUrl = async (url: string) => {
    try {
      await bridge.send('VKWebAppOpenURL' as never, { url } as never);
      return;
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const openCommunityInstall = async () => {
    const appId = launchParams?.vk_app_id;
    const groupId = Number(launchParams?.vk_group_id ?? 0);

    if (groupId > 0) {
      try {
        await bridge.send('VKWebAppAddToCommunity' as never, { group_id: groupId } as never);
        setHomeSection('payments');
        setPaymentStatus({
          tone: 'success',
          message:
            'Приложение добавлено в сообщество. Откройте его внутри группы и завершите активацию на этом экране.',
        });
        return;
      } catch {
        // Fall back to opening the app page if direct install is unavailable.
      }
    }

    const fallbackUrl = appId ? `https://vk.com/app${appId}` : 'https://vk.com/apps?act=manage';
    await openExternalPaymentUrl(fallbackUrl);
    setHomeSection('payments');
    setPaymentStatus({
      tone: 'neutral',
      message:
        'Откройте приложение в нужном сообществе VK, затем вернитесь на экран активации и оплатите доступ.',
    });
  };

  const startSubscriptionPayment = async () => {
    if (typeof window === 'undefined' || isProcessingPayment) {
      return;
    }

    setHomeSection('payments');
    setPaymentStatus({ tone: 'neutral', message: 'Создаём платёж YooKassa...' });
    setIsProcessingPayment(true);

    try {
      const response = await fetch('/api/yookassa?action=create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          plan: adminSettings.subscription.plan,
          groupId: currentGroupId,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            data?: {
              payment?: {
                id: string;
                confirmationUrl: string;
              };
            };
            error?: string;
          }
        | null;

      if (!response.ok || !payload?.ok || !payload.data?.payment?.confirmationUrl) {
        throw new Error(payload?.error || 'Не удалось создать платёж YooKassa');
      }

      window.localStorage.setItem(
        PENDING_YOOKASSA_PAYMENT_KEY,
        JSON.stringify({
          paymentId: payload.data.payment.id,
        }),
      );

      await openExternalPaymentUrl(payload.data.payment.confirmationUrl);
      setIsProcessingPayment(false);
    } catch (error) {
      setPaymentStatus({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Не удалось создать платёж YooKassa',
      });
      setIsProcessingPayment(false);
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    const paymentIdFromUrl = searchParams.get('paymentId');
    const pendingRaw = window.localStorage.getItem(PENDING_YOOKASSA_PAYMENT_KEY);
    const pendingPayment = pendingRaw
      ? (JSON.parse(pendingRaw) as { paymentId?: string })
      : null;
    const paymentId =
      paymentIdFromUrl && paymentIdFromUrl !== 'return'
        ? paymentIdFromUrl
        : pendingPayment?.paymentId;

    if (!paymentId) {
      return;
    }

    let isCancelled = false;

    const verifyPayment = async () => {
      setActiveView('home');
      setHomeSection('payments');
      setIsProcessingPayment(true);
      setPaymentStatus({ tone: 'neutral', message: 'Проверяем статус оплаты YooKassa...' });

      try {
        const response = await fetch('/api/yookassa?action=check', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            paymentId,
            plan: adminSettings.subscription.plan,
            groupId: currentGroupId,
          }),
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              ok?: boolean;
              data?: {
                activated?: boolean;
                subscription?: CalculatorAdminSettings['subscription'];
              };
              error?: string;
            }
          | null;

        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || 'Не удалось проверить платёж YooKassa');
        }

        if (isCancelled) {
          return;
        }

        if (payload.data?.activated && payload.data.subscription) {
          const nextSettings: CalculatorAdminSettings = {
            ...adminSettings,
            subscription: {
              ...createDefaultSubscriptionSettings(),
              ...payload.data.subscription,
            },
          };
          persistAdminSettings(nextSettings);
          window.localStorage.removeItem(PENDING_YOOKASSA_PAYMENT_KEY);
          setPaymentStatus({
            tone: 'success',
            message: `Оплата прошла. Доступ активирован до ${new Date(
              payload.data.subscription.paidUntil || buildNextPaidUntil(),
            ).toLocaleDateString('ru-RU')}.`,
          });
        } else {
          setPaymentStatus({
            tone: 'neutral',
            message: 'Платёж ещё не подтверждён. Попробуйте обновить страницу через минуту.',
          });
        }
      } catch (error) {
        if (!isCancelled) {
          setPaymentStatus({
            tone: 'error',
            message:
              error instanceof Error ? error.message : 'Не удалось проверить платёж YooKassa',
          });
        }
      } finally {
        if (!isCancelled) {
          setIsProcessingPayment(false);
          clearPaymentIdFromUrl();
        }
      }
    };

    verifyPayment();

    return () => {
      isCancelled = true;
    };
  }, []);

  const handleSaveTemplate = (template: CalculatorTemplate) => {
    if (!isViewerGroupAdmin) {
      return;
    }

    const normalizedTemplate = normalizeTemplateRecord({
      ...template,
      title: clampTemplateTitle(template.title),
      description: clampTemplateDescription(template.description),
      lastModifiedBy: currentAdminLabel,
    });
    const next = upsertTemplate(normalizedTemplate);
    persistTemplates(next);
    setSelectedTemplate(normalizedTemplate);
  };

  const duplicateTemplate = (template: CalculatorTemplate) => {
    if (!isViewerGroupAdmin) {
      return;
    }

    if (!hasActiveSubscription) {
      setHomeSection('payments');
      setActiveView('home');
      return;
    }

    if (!canCreateMoreTemplates) {
      setHomeSection('payments');
      setActiveView('home');
      return;
    }

    const now = new Date().toISOString();
    const normalizedBaseTitle = clampTemplateTitle(template.title).replace(
      /\s+\(копия(?:\s+\d+)?\)$/u,
      '',
    );
    const duplicatePattern = new RegExp(
      `^${normalizedBaseTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(копия(?: (\\d+))?\\)$`,
      'u',
    );
    const highestCopyNumber = templates.reduce((max, item) => {
      const match = item.title.match(duplicatePattern);
      if (!match) {
        return max;
      }

      const copyNumber = match[1] ? Number(match[1]) : 1;
      return Number.isFinite(copyNumber) ? Math.max(max, copyNumber) : max;
    }, 0);
    const nextCopyNumber = highestCopyNumber + 1;
    const duplicateSuffix =
      nextCopyNumber === 1 ? ' (копия)' : ` (копия ${nextCopyNumber})`;
    const trimmedBaseTitle = normalizedBaseTitle.slice(
      0,
      Math.max(0, MAX_TEMPLATE_TITLE_LENGTH - duplicateSuffix.length),
    );
    const duplicate: CalculatorTemplate = {
      ...template,
      id: crypto.randomUUID(),
      publicationStatus: 'draft',
      publicId: createTemplatePublicId(),
      publishedAt: undefined,
      lastModifiedBy: currentAdminLabel,
      title: `${trimmedBaseTitle}${duplicateSuffix}`,
      description: clampTemplateDescription(template.description),
      createdAt: now,
      updatedAt: now,
      fields: template.fields.map((field) => ({
        ...field,
        id: crypto.randomUUID(),
        options: field.options?.map((option) => ({
          ...option,
          id: crypto.randomUUID(),
        })),
      })),
    };

    const next = upsertTemplate(duplicate);
    persistTemplates(next);
  };

  const deleteTemplate = (template: CalculatorTemplate) => {
    if (!isViewerGroupAdmin) {
      return;
    }

    const next = templates.filter((item) => item.id !== template.id);
    persistTemplates(next);

    if (selectedTemplate?.id === template.id) {
      setSelectedTemplate(undefined);
    }
  };

  const updateTemplatePublicationStatus = (
    template: CalculatorTemplate,
    publicationStatus: CalculatorPublicationStatus,
  ) => {
    if (!isViewerGroupAdmin) {
      return;
    }

    const now = new Date().toISOString();
    const nextTemplate = normalizeTemplateRecord({
      ...template,
      publicationStatus,
      publishedAt:
        publicationStatus === 'published'
          ? template.publishedAt ?? now
          : undefined,
      updatedAt: now,
      lastModifiedBy: currentAdminLabel,
    });

    const next = upsertTemplate(nextTemplate);
    persistTemplates(next);

    if (selectedTemplate?.id === template.id) {
      setSelectedTemplate(nextTemplate);
    }
  };

  const handleCopyTemplateLink = async (template: CalculatorTemplate) => {
    if (!isViewerGroupAdmin) {
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(getPublicCalculatorUrl(template.publicId));
  };

  const moveTemplateToFolder = (template: CalculatorTemplate, folderId?: string) => {
    if (!isViewerGroupAdmin) {
      return;
    }

    if (!hasActiveSubscription) {
      setHomeSection('payments');
      setActiveView('home');
      return;
    }

    const moved: CalculatorTemplate = {
      ...template,
      folderId,
      updatedAt: new Date().toISOString(),
    };

    const next = upsertTemplate(moved);
    persistTemplates(next);

    if (selectedTemplate?.id === template.id) {
      setSelectedTemplate(moved);
    }
  };

  const createFolder = () => {
    if (!isViewerGroupAdmin) {
      return;
    }

    if (!hasActiveSubscription) {
      setHomeSection('payments');
      setActiveView('home');
      return;
    }

    const now = new Date().toISOString();
    const folder: CalculatorFolder = {
      id: crypto.randomUUID(),
      name: 'Новая папка',
      createdAt: now,
      updatedAt: now,
    };

    const next = upsertFolder(folder);
    setFolders(next);
    setActiveFolderId(folder.id);
  };

  const renameFolder = (folderId: string, name: string) => {
    if (!isViewerGroupAdmin) {
      return;
    }

    if (!hasActiveSubscription) {
      setHomeSection('payments');
      setActiveView('home');
      return;
    }

    const current = folders.find((folder) => folder.id === folderId);
    if (!current) {
      return;
    }

    const nextFolder: CalculatorFolder = {
      ...current,
      name: clampFolderName(name.trim() || 'Новая папка'),
      updatedAt: new Date().toISOString(),
    };

    const next = upsertFolder(nextFolder);
    setFolders(next);
  };

  const deleteFolder = (folderId: string) => {
    if (!isViewerGroupAdmin) {
      return;
    }

    if (!hasActiveSubscription) {
      setHomeSection('payments');
      setActiveView('home');
      return;
    }

    const nextFolders = folders.filter((folder) => folder.id !== folderId);
    const nextTemplates = templates.map((template) =>
      template.folderId === folderId ? { ...template, folderId: undefined } : template,
    );

    saveFolders(nextFolders);
    setFolders(nextFolders);
    persistTemplates(nextTemplates);

    if (activeFolderId === folderId) {
      setActiveFolderId('all');
    }
  };

  return (
    <SplitLayout>
      <SplitCol width="100%" maxWidth="100%">
        <View activePanel={activeView}>
          <Panel id="home">
            {isViewerGroupAdmin ? (
              <HomePage
                folders={folders}
                activeFolderId={activeFolderId}
                allTemplates={sortedTemplates}
                templates={visibleTemplates}
                adminSettings={adminSettings}
                adminProfile={adminProfile}
                isAdminNavOpen={isAdminNavOpen}
                currentSection={homeSection}
                requests={requests}
                onSectionChange={setHomeSection}
                onSaveAdminSettings={handleSaveAdminSettings}
                onToggleAdminNav={() => setIsAdminNavOpen((current) => !current)}
                onCreateFolder={createFolder}
                onDeleteFolder={deleteFolder}
                onRenameFolder={renameFolder}
                onSelectFolder={setActiveFolderId}
                onCreate={createTemplateInActiveFolder}
                onUsePreset={createTemplateFromCatalog}
                onOpen={openCalculator}
                onEdit={openBuilder}
                onDuplicateTemplate={duplicateTemplate}
                onDeleteTemplate={deleteTemplate}
                onMoveTemplateToFolder={moveTemplateToFolder}
                onUpdateTemplateStatus={updateTemplatePublicationStatus}
                onCopyTemplateLink={handleCopyTemplateLink}
                hasActiveSubscription={hasActiveSubscription}
                isSuperAdmin={isSuperAdmin}
                currentGroupId={currentGroupId}
                canCreateMoreTemplates={canCreateMoreTemplates}
                templateLimit={BASIC_TEMPLATE_LIMIT}
                onStartPayment={startSubscriptionPayment}
                onInstallInCommunity={openCommunityInstall}
                onGrantProAccess={handleGrantProAccess}
                isProcessingPayment={isProcessingPayment}
                paymentStatus={paymentStatus}
                isDesktopClient={isDesktopClient}
                isCompactViewport={isCompactViewport}
                isCommunityContext={currentGroupId > 0}
              />
            ) : null}
          </Panel>
          <Panel id="builder">
            <BuilderPage
              initialTemplate={selectedTemplate}
              onBack={() => setActiveView('home')}
              onSave={handleSaveTemplate}
              canUseBooking={hasActiveSubscription}
              canUseProFeatures={hasActiveSubscription}
            />
          </Panel>
          <Panel id="calculator">
            {selectedTemplate ? (
              <CalculatorPage
                template={selectedTemplate}
                onOpenAdmin={isViewerGroupAdmin ? openAdminHome : undefined}
                currentGroupId={currentGroupId}
                onRequestCreated={(request) =>
                  setRequests((current) => [request, ...current.filter((item) => item.id !== request.id)])
                }
              />
            ) : (
              <div className="calculator-page calculator-page_empty">
                <div className="calculator-page__shell">
                  <div className="calculator-page__hero-copy calculator-page__hero-copy_empty">
                    <div className="calculator-page__eyebrow">Публичная версия</div>
                    <h1 className="calculator-page__title">Калькулятор пока не опубликован</h1>
                    <p className="calculator-page__description">
                      После публикации собранный калькулятор появится здесь как главная страница приложения.
                    </p>
                    {isViewerGroupAdmin ? (
                      <button
                        className="calculator-page__back"
                        type="button"
                        onClick={openAdminHome}
                      >
                        Открыть админку
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </Panel>
        </View>
      </SplitCol>
    </SplitLayout>
  );
};

export default App;
