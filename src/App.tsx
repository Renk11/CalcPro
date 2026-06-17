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
  updateRequestStatus,
  upsertFolder,
  upsertTemplate,
} from './shared/storage/localStorage';
import {
  buildNextPaidUntil,
  createDefaultSubscriptionSettings,
  getEffectiveSubscriptionPlan,
  getSubscriptionPlanConfig,
  isSubscriptionActive,
} from './shared/subscription';
import {
  clearPendingPayment,
  readPendingPayment,
  writePendingPayment,
} from './shared/storage/pendingPaymentStorage';
import type {
  CalculatorPublicationStatus,
  CalculatorAdminSettings,
  CalculatorConnectedCommunity,
  CalculatorFolder,
  CalculatorRequest,
  CalculatorSubscriptionPlan,
  CalculatorTemplate,
} from './shared/types/calculator';

type AppView = 'home' | 'builder' | 'calculator';
type ActiveFolderId = 'all' | string;

export type AdminSection =
  | 'communities'
  | 'calculators'
  | 'templates'
  | 'analytics'
  | 'integrations'
  | 'requests'
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
const SUPER_ADMIN_IDS = new Set([139346496]);

type PaymentStatusTone = 'neutral' | 'success' | 'error';

type PaymentStatus = {
  tone: PaymentStatusTone;
  message: string;
};

const COMMUNITY_ADMIN_ROLES = new Set(['admin', 'editor', 'moder']);
const DEFAULT_FOLDER_NAME = 'Новая папка';

const parsePositiveInteger = (rawValue: string | null | undefined) => {
  const value = Number(rawValue);
  return Number.isInteger(value) && value > 0 ? value : 0;
};

const getMonthRequestCount = (requests: CalculatorRequest[], date = new Date()) => {
  const month = date.getMonth();
  const year = date.getFullYear();

  return requests.filter((request) => {
    const createdAt = new Date(request.createdAt);
    return createdAt.getMonth() === month && createdAt.getFullYear() === year;
  }).length;
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
  const [connectedCommunities, setConnectedCommunities] = useState<CalculatorConnectedCommunity[]>([]);
  const [activeAdminGroupId, setActiveAdminGroupId] = useState(0);
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
  const currentPlan = useMemo(
    () => getEffectiveSubscriptionPlan(adminSettings.subscription),
    [adminSettings.subscription],
  );
  const paidPlanConfig = useMemo(
    () => getSubscriptionPlanConfig(adminSettings.subscription.plan),
    [adminSettings.subscription.plan],
  );
  const monthlyRequestsUsed = useMemo(() => getMonthRequestCount(requests), [requests]);
  const requestLimit = currentPlan.monthlyRequestLimit;
  const canCreateMoreRequests = requestLimit == null || monthlyRequestsUsed < requestLimit;
  const canCreateMoreTemplates =
    currentPlan.calculatorLimit == null || templates.length < currentPlan.calculatorLimit;
  const canUseTemplates = currentPlan.features.templates;
  const canUseAnalytics = currentPlan.features.analytics;
  const canUseAdvancedFormulas = currentPlan.features.advancedFormulas;
  const canUseNotifications = currentPlan.features.notifications;
  const canUseRequestStatuses = currentPlan.features.requestStatuses;
  const canUseFolders = currentPlan.features.folders;
  const canHideBranding = currentPlan.features.hideBranding;
  const canUseBooking = currentPlan.features.booking;
  const fallbackGroupId = getFallbackGroupIdFromLocation();
  const currentGroupId = Number(launchParams?.vk_group_id ?? 0) || fallbackGroupId;
  const effectiveAdminGroupId = activeAdminGroupId || currentGroupId;
  const viewerGroupRole = launchParams?.vk_viewer_group_role ?? 'none';
  const isViewerGroupAdmin = COMMUNITY_ADMIN_ROLES.has(viewerGroupRole);
  const isSuperAdmin = Boolean(adminProfile.id && SUPER_ADMIN_IDS.has(adminProfile.id));

  useEffect(() => {
    setStorageGroupScope(effectiveAdminGroupId);
    setTemplates(getTemplates());
    setFolders(getFolders());
    setRequests(getRequests());
    setAdminSettings(getAdminSettings());
    setSelectedTemplate(undefined);
    setActiveFolderId('all');
  }, [effectiveAdminGroupId]);

  useEffect(() => {
    if (currentGroupId > 0 && activeAdminGroupId === 0) {
      setActiveAdminGroupId(currentGroupId);
    }
  }, [activeAdminGroupId, currentGroupId]);

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
    const viewerId = adminProfile.id;

    if (!viewerId) {
      return;
    }

    let isCancelled = false;

    const syncCommunities = async () => {
      try {
        if (currentGroupId > 0) {
          const connectedResponse = await fetch('/api/communities', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              viewerId,
              groupId: currentGroupId,
              name: `Сообщество ${currentGroupId}`,
              role: viewerGroupRole,
              workspacePlan: currentPlan.id,
            }),
          });
          const connectedPayload = (await connectedResponse.json().catch(() => null)) as
            | { ok?: boolean; data?: CalculatorConnectedCommunity[] }
            | null;

          if (!isCancelled && connectedResponse.ok && connectedPayload?.ok && Array.isArray(connectedPayload.data)) {
            setConnectedCommunities(connectedPayload.data);
            return;
          }
        }

        const response = await fetch(`/api/communities?viewerId=${viewerId}`);
        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; data?: CalculatorConnectedCommunity[] }
          | null;

        if (!isCancelled && response.ok && payload?.ok && Array.isArray(payload.data)) {
          setConnectedCommunities(payload.data);
        }
      } catch {
        // Keep the local communities list empty when the API is unavailable.
      }
    };

    syncCommunities();

    return () => {
      isCancelled = true;
    };
  }, [adminProfile.id, currentGroupId, currentPlan.id, viewerGroupRole]);

  useEffect(() => {
    let isCancelled = false;

    const syncAdminSettings = async () => {
      try {
        const query = effectiveAdminGroupId > 0 ? `?groupId=${effectiveAdminGroupId}` : '';
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
  }, [effectiveAdminGroupId]);

  useEffect(() => {
    let isCancelled = false;

    const syncTemplatesFromServer = async () => {
      try {
        const query = effectiveAdminGroupId > 0 ? `?groupId=${effectiveAdminGroupId}` : '';
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
              groupId: effectiveAdminGroupId,
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
  }, [effectiveAdminGroupId]);

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

    if (!canUseTemplates) {
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

    const query = effectiveAdminGroupId > 0 ? `?groupId=${effectiveAdminGroupId}` : '';

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

      if (targetGroupId === effectiveAdminGroupId) {
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

    const query = effectiveAdminGroupId > 0 ? `?groupId=${effectiveAdminGroupId}` : '';

    fetch(`/api/templates${query}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        groupId: effectiveAdminGroupId,
        templates: nextTemplates,
      }),
    }).catch(() => {
      // Local templates remain saved even if the API request fails.
    });
  };

  const handleUpdateRequestStatus = (
    requestId: string,
    status: CalculatorRequest['status'],
  ) => {
    const next = updateRequestStatus(requestId, status);
    setRequests(next);
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
    let addedGroupId = 0;

    try {
      const result = (await bridge.send('VKWebAppAddToCommunity' as never, {
        hide_success_modal: false,
      } as never)) as { group_id?: number };
      addedGroupId =
        Number(result?.group_id) || Number(launchParams?.vk_group_id ?? 0) || currentGroupId;
    } catch {
      setHomeSection('payments');
      setPaymentStatus({
        tone: 'neutral',
        message:
          'Не удалось открыть выбор сообщества автоматически. Откройте приложение из нужной группы VK и повторите установку там.',
      });
      return;
    }

    try {
      if (adminProfile.id && addedGroupId > 0) {
        const response = await fetch('/api/communities', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            viewerId: adminProfile.id,
            groupId: addedGroupId,
            role: viewerGroupRole,
            workspacePlan: currentPlan.id,
          }),
        });
        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; data?: CalculatorConnectedCommunity[]; error?: string }
          | null;

        if (!response.ok || !payload?.ok || !Array.isArray(payload.data)) {
          throw new Error(
            payload?.error ||
              `Сервис добавлен в группу ID ${addedGroupId}, но не удалось сохранить её в кабинете.`,
          );
        }

        setConnectedCommunities(payload.data);
      }

      setHomeSection('payments');
      setPaymentStatus({
        tone: 'success',
        message:
          addedGroupId > 0
            ? `Приложение добавлено в сообщество ID ${addedGroupId}. Откройте его внутри группы и завершите активацию на этом экране.`
            : 'Приложение добавлено в сообщество. Откройте его внутри группы и завершите активацию на этом экране.',
      });
    } catch (error) {
      setHomeSection('payments');
      setPaymentStatus({
        tone: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Не удалось подключить сообщество к кабинету.',
      });
    }
  };

  const startSubscriptionPayment = async (plan: CalculatorSubscriptionPlan) => {
    if (typeof window === 'undefined' || isProcessingPayment) {
      return;
    }

    const planConfig = getSubscriptionPlanConfig(plan);
    setHomeSection('payments');
    setPaymentStatus({
      tone: 'neutral',
      message: `Создаём платёж за тариф ${planConfig.name}...`,
    });
    setIsProcessingPayment(true);

    try {
      const response = await fetch('/api/yookassa?action=create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          plan,
          groupId: effectiveAdminGroupId,
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

      writePendingPayment(payload.data.payment.id, plan);

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
    const pendingPayment = readPendingPayment();
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
            plan: pendingPayment?.plan ?? paidPlanConfig.id,
            groupId: effectiveAdminGroupId,
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
          clearPendingPayment();
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
  }, [adminSettings, effectiveAdminGroupId, paidPlanConfig.id]);

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

    if (!canUseTemplates) {
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
      /\s+\(РєРѕРїРёСЏ(?:\s+\d+)?\)$/u,
      '',
    );
    const duplicatePattern = new RegExp(
      `^${normalizedBaseTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(РєРѕРїРёСЏ(?: (\\d+))?\\)$`,
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
      nextCopyNumber === 1 ? ' (РєРѕРїРёСЏ)' : ` (РєРѕРїРёСЏ ${nextCopyNumber})`;
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

    if (!canUseFolders) {
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

  const handleTransferTemplateToCommunity = async (
    template: CalculatorTemplate,
    targetGroupId: number,
  ) => {
    if (!isViewerGroupAdmin || targetGroupId <= 0 || targetGroupId === effectiveAdminGroupId) {
      return;
    }

    try {
      const response = await fetch('/api/templates?action=transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          templateId: template.id,
          fromGroupId: effectiveAdminGroupId,
          toGroupId: targetGroupId,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            data?: {
              sourceTemplates?: CalculatorTemplate[];
            };
            error?: string;
          }
        | null;

      if (!response.ok || !payload?.ok || !Array.isArray(payload.data?.sourceTemplates)) {
        throw new Error(payload?.error || 'Не удалось перенести калькулятор');
      }

      const nextSourceTemplates = payload.data.sourceTemplates.map((item) =>
        normalizeTemplateRecord(item),
      );
      persistTemplates(nextSourceTemplates);

      if (selectedTemplate?.id === template.id) {
        setSelectedTemplate(undefined);
      }

      setPaymentStatus({
        tone: 'success',
        message: `Калькулятор перенесён в сообщество ID ${targetGroupId}. В новой группе он сохранён как черновик.`,
      });
    } catch (error) {
      setPaymentStatus({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Не удалось перенести калькулятор',
      });
    }
  };

  const createFolder = () => {
    if (!isViewerGroupAdmin) {
      return;
    }

    if (!canUseFolders) {
      setHomeSection('payments');
      setActiveView('home');
      return;
    }

    const now = new Date().toISOString();
    const folder: CalculatorFolder = {
      id: crypto.randomUUID(),
      name: DEFAULT_FOLDER_NAME,
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

    if (!canUseFolders) {
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
      name: clampFolderName(name.trim() || DEFAULT_FOLDER_NAME),
      updatedAt: new Date().toISOString(),
    };

    const next = upsertFolder(nextFolder);
    setFolders(next);
  };

  const deleteFolder = (folderId: string) => {
    if (!isViewerGroupAdmin) {
      return;
    }

    if (!canUseFolders) {
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

  const handleSelectAdminGroup = (groupId: number) => {
    setActiveAdminGroupId(groupId);

    if (adminProfile.id && groupId > 0) {
      fetch('/api/communities?action=touch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          viewerId: adminProfile.id,
          groupId,
        }),
      }).catch(() => {
        // The selected group remains active locally even if the touch request fails.
      });
    }
  };

  const handleDisconnectCommunity = (groupId: number) => {
    if (!adminProfile.id || groupId <= 0 || groupId === activeAdminGroupId) {
      return;
    }

    fetch('/api/communities?action=disconnect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        viewerId: adminProfile.id,
        groupId,
      }),
    })
      .then((response) => response.json().catch(() => null))
      .then((payload: { ok?: boolean; data?: CalculatorConnectedCommunity[] } | null) => {
        if (payload?.ok && Array.isArray(payload.data)) {
          setConnectedCommunities(payload.data);
        }
      })
      .catch(() => {
        // Keep the current communities list when disconnect sync fails.
      });
  };

  return (
    <SplitLayout>
      <SplitCol width="100%" maxWidth="100%">
        <View activePanel={activeView}>
          <Panel id="home">
            {isViewerGroupAdmin ? (
              <HomePage
                connectedCommunities={connectedCommunities}
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
                onUpdateRequestStatus={handleUpdateRequestStatus}
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
                onTransferTemplateToCommunity={handleTransferTemplateToCommunity}
                onUpdateTemplateStatus={updateTemplatePublicationStatus}
                onCopyTemplateLink={handleCopyTemplateLink}
                currentPlan={currentPlan}
                configuredPlan={paidPlanConfig}
                hasActiveSubscription={hasActiveSubscription}
                isSuperAdmin={isSuperAdmin}
                currentGroupId={effectiveAdminGroupId}
                launchGroupId={currentGroupId}
                canCreateMoreTemplates={canCreateMoreTemplates}
                canCreateMoreRequests={canCreateMoreRequests}
                monthlyRequestsUsed={monthlyRequestsUsed}
                onSelectAdminGroup={handleSelectAdminGroup}
                onDisconnectCommunity={handleDisconnectCommunity}
                onStartPayment={startSubscriptionPayment}
                onInstallInCommunity={openCommunityInstall}
                requestLimit={requestLimit}
                canUseTemplates={canUseTemplates}
                canUseAnalytics={canUseAnalytics}
                canUseNotifications={canUseNotifications}
                canUseRequestStatuses={canUseRequestStatuses}
                canUseFolders={canUseFolders}
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
              canUseBooking={canUseBooking}
              canUseProFeatures={canUseAdvancedFormulas}
            />
          </Panel>
          <Panel id="calculator">
            {selectedTemplate ? (
              <CalculatorPage
                template={selectedTemplate}
                onOpenAdmin={isViewerGroupAdmin ? openAdminHome : undefined}
                currentGroupId={currentGroupId}
                canSubmitRequests={canCreateMoreRequests}
                requestLimit={requestLimit}
                requestsUsedThisMonth={monthlyRequestsUsed}
                showBranding={!canHideBranding}
                onRequestCreated={(request) =>
                  setRequests((current) => [request, ...current.filter((item) => item.id !== request.id)])
                }
              />
            ) : (
              <div className="calculator-page calculator-page_empty">
                <div className="calculator-page__shell">
                  <div className="calculator-page__hero-copy calculator-page__hero-copy_empty">
                    <div className="calculator-page__eyebrow">
                      {currentGroupId > 0
                        ? '\u041f\u0443\u0431\u043b\u0438\u0447\u043d\u0430\u044f \u0432\u0435\u0440\u0441\u0438\u044f'
                        : '\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u044f'}
                    </div>
                    <h1 className="calculator-page__title">
                      {currentGroupId > 0
                        ? '\u041a\u0430\u043b\u044c\u043a\u0443\u043b\u044f\u0442\u043e\u0440 \u043f\u043e\u043a\u0430 \u043d\u0435 \u043e\u043f\u0443\u0431\u043b\u0438\u043a\u043e\u0432\u0430\u043d'
                        : '\u0423\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u0435 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435 \u0432 \u0441\u043e\u043e\u0431\u0449\u0435\u0441\u0442\u0432\u043e'}
                    </h1>
                    <p className="calculator-page__description">
                      {currentGroupId > 0
                        ? '\u041f\u043e\u0441\u043b\u0435 \u043f\u0443\u0431\u043b\u0438\u043a\u0430\u0446\u0438\u0438 \u0441\u043e\u0431\u0440\u0430\u043d\u043d\u044b\u0439 \u043a\u0430\u043b\u044c\u043a\u0443\u043b\u044f\u0442\u043e\u0440 \u043f\u043e\u044f\u0432\u0438\u0442\u0441\u044f \u0437\u0434\u0435\u0441\u044c \u043a\u0430\u043a \u0433\u043b\u0430\u0432\u043d\u0430\u044f \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u044f.'
                        : '\u0421\u0435\u0439\u0447\u0430\u0441 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435 \u043e\u0442\u043a\u0440\u044b\u0442\u043e \u0432\u043d\u0435 \u0433\u0440\u0443\u043f\u043f\u044b VK. \u0427\u0442\u043e\u0431\u044b \u043f\u043e\u0441\u0435\u0442\u0438\u0442\u0435\u043b\u0438 \u0443\u0432\u0438\u0434\u0435\u043b\u0438 \u043a\u0430\u043b\u044c\u043a\u0443\u043b\u044f\u0442\u043e\u0440, \u0441\u043d\u0430\u0447\u0430\u043b\u0430 \u0432\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u0441\u0442\u0432\u043e \u0438 \u0443\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u0435 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435 \u0442\u0443\u0434\u0430.'}
                    </p>
                    {currentGroupId === 0 ? (
                      <button
                        className="calculator-page__back"
                        type="button"
                        onClick={openCommunityInstall}
                      >
                        {'\u0423\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u0435 \u0432 \u0441\u043e\u043e\u0431\u0449\u0435\u0441\u0442\u0432\u043e'}
                      </button>
                    ) : isViewerGroupAdmin ? (
                      <button
                        className="calculator-page__back"
                        type="button"
                        onClick={openAdminHome}
                      >
                        {'\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0430\u0434\u043c\u0438\u043d\u043a\u0443'}
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


