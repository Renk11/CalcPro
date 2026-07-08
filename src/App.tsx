import { useEffect, useMemo, useState } from 'react';
import { Suspense, lazy, useRef } from 'react';
import bridge, {
  parseURLSearchParamsForGetLaunchParams,
  type GetLaunchParamsResponse,
} from '@vkontakte/vk-bridge';
import { Panel, SplitCol, SplitLayout, View } from '@vkontakte/vkui';
import calcProLogo from '../calcpro-logo-transparent.png';
import {
  clampFolderName,
  clampTemplateDescription,
  clampTemplateTitle,
  createEmptyTemplate,
  createTemplatePublicId,
  MAX_TEMPLATE_TITLE_LENGTH,
} from './entities/calculator/model';
import {
  deleteRequest,
  getAdminSettings,
  getFolders,
  getRequests,
  getTemplates,
  normalizeTemplateRecord,
  resetAllCalcProStorage,
  resetCalcProStorageForGroup,
  saveAdminSettings,
  saveFolders,
  saveRequests,
  saveTemplates,
  setStorageGroupScope,
  updateRequest,
  upsertFolder,
  upsertTemplate,
} from './shared/storage/localStorage';
import {
  buildNextPaidUntil,
  createDefaultSubscriptionSettings,
  getEffectiveSubscriptionPlan,
  getSubscriptionMonthlyUsage,
  getSubscriptionPlanConfig,
  isSubscriptionActive,
} from './shared/subscription';
import {
  clearPendingPayment,
  readPendingPayment,
  writePendingPayment,
} from './shared/storage/pendingPaymentStorage';
import { getVkLaunchParamsErrorMessage, isVkLaunchParamsError } from './shared/apiErrors';
import { createRandomId } from './shared/randomId';
import { appendVkLaunchParamsToPath, createVkAuthHeaders, getWindowLaunchParams } from './shared/vkAuth';
import type {
  CalculatorPublicationStatus,
  CalculatorAdminSettings,
  CalculatorAnalyticsEvent,
  CalculatorConnectedCommunity,
  CalculatorFolder,
  CalculatorRequestHistoryEntry,
  CalculatorRequest,
  CalculatorSubscriptionPlan,
  CalculatorTemplate,
} from './shared/types/calculator';

const preloadHomePage = () => import('./pages/HomePage');
const preloadCalculatorPage = () => import('./pages/CalculatorPage');

const HomePage = lazy(async () => {
  const module = await preloadHomePage();
  return { default: module.HomePage };
});

const CalculatorPage = lazy(async () => {
  const module = await preloadCalculatorPage();
  return { default: module.CalculatorPage };
});

const BuilderPage = lazy(async () => {
  const module = await import('./pages/BuilderPage');
  return { default: module.BuilderPage };
});

type AppView = 'home' | 'builder' | 'calculator';
type ActiveFolderId = 'all' | string;

export type AdminSection =
  | 'communities'
  | 'calculators'
  | 'templates'
  | 'analytics'
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
  nickname: 'vk.com/public180574723',
};

const getProfileLabel = (profile: AdminProfile) =>
  [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim() ||
  profile.nickname ||
  'Администратор';

const SUPER_ADMIN_IDS = new Set([139346496]);
const WEB_MONETIZATION_PLATFORMS = new Set(['desktop_web', 'mobile_web']);

type PaymentStatusTone = 'neutral' | 'success' | 'error';

type PaymentStatus = {
  tone: PaymentStatusTone;
  message: string;
};

const AdminPageFallback = ({ title }: { title: string }) => (
  <div className="calculator-page calculator-page_empty">
    <div className="calculator-page__shell">
      <div className="app-skeleton app-skeleton_admin">
        <div className="app-skeleton__panel app-skeleton__panel_sidebar">
          <span className="app-skeleton__shine" />
          <div className="app-skeleton__line app-skeleton__line_title" />
          <div className="app-skeleton__line app-skeleton__line_chip" />
          <div className="app-skeleton__stack">
            <div className="app-skeleton__card app-skeleton__card_folder" />
            <div className="app-skeleton__card app-skeleton__card_folder" />
            <div className="app-skeleton__card app-skeleton__card_folder" />
          </div>
        </div>
        <div className="app-skeleton__panel app-skeleton__panel_content">
          <span className="app-skeleton__shine" />
          <div className="app-skeleton__fallback-title">{title}</div>
          <div className="app-skeleton__line app-skeleton__line_eyebrow" />
          <div className="app-skeleton__line app-skeleton__line_heading" />
          <div className="app-skeleton__grid">
            <div className="app-skeleton__card app-skeleton__card_large" />
            <div className="app-skeleton__card app-skeleton__card_large" />
            <div className="app-skeleton__card app-skeleton__card_large" />
          </div>
        </div>
      </div>
    </div>
  </div>
);

const CalculatorPageFallback = () => (
  <div className="calculator-page calculator-page_empty">
    <div className="calculator-page__shell">
      <div className="app-skeleton app-skeleton_calculator">
        <div className="app-skeleton__panel app-skeleton__panel_content">
          <span className="app-skeleton__shine" />
          <div className="app-skeleton__line app-skeleton__line_eyebrow" />
          <div className="app-skeleton__line app-skeleton__line_heading" />
          <div className="app-skeleton__line app-skeleton__line_body" />
          <div className="app-skeleton__stack">
            <div className="app-skeleton__card app-skeleton__card_field" />
            <div className="app-skeleton__card app-skeleton__card_field" />
            <div className="app-skeleton__card app-skeleton__card_field" />
          </div>
        </div>
        <div className="app-skeleton__panel app-skeleton__panel_sidecard">
          <span className="app-skeleton__shine" />
          <div className="app-skeleton__card app-skeleton__card_side" />
        </div>
      </div>
    </div>
  </div>
);

const BuilderPageFallback = () => (
  <div className="builder-shell builder-shell_editor builder-shell_loading">
    <div className="builder-editor__topbar builder-editor__topbar_loading">
      <div className="app-skeleton__line app-skeleton__line_nav" />
      <div className="app-skeleton__line app-skeleton__line_nav app-skeleton__line_nav_wide" />
    </div>
    <div className="app-skeleton app-skeleton_builder">
      <div className="app-skeleton__panel app-skeleton__panel_sidebar">
        <span className="app-skeleton__shine" />
        <div className="app-skeleton__line app-skeleton__line_title" />
        <div className="app-skeleton__stack">
          <div className="app-skeleton__card app-skeleton__card_library" />
          <div className="app-skeleton__card app-skeleton__card_library" />
          <div className="app-skeleton__card app-skeleton__card_library" />
        </div>
      </div>
      <div className="app-skeleton__panel app-skeleton__panel_content">
        <span className="app-skeleton__shine" />
        <div className="app-skeleton__line app-skeleton__line_heading" />
        <div className="app-skeleton__canvas">
          <div className="app-skeleton__card app-skeleton__card_builder-field" />
          <div className="app-skeleton__card app-skeleton__card_builder-field" />
          <div className="app-skeleton__card app-skeleton__card_builder-field app-skeleton__card_builder-field_half" />
          <div className="app-skeleton__card app-skeleton__card_builder-field app-skeleton__card_builder-field_half" />
        </div>
      </div>
      <div className="app-skeleton__panel app-skeleton__panel_sidebar">
        <span className="app-skeleton__shine" />
        <div className="app-skeleton__line app-skeleton__line_title" />
        <div className="app-skeleton__card app-skeleton__card_inspector" />
      </div>
    </div>
  </div>
);

const StartupSplash = () => (
  <div className="startup-splash" role="status" aria-live="polite" aria-label="Загрузка CalcPro">
    <div className="startup-splash__backdrop" aria-hidden="true">
      <span className="startup-splash__mesh startup-splash__mesh_left" />
      <span className="startup-splash__mesh startup-splash__mesh_right" />
      <span className="startup-splash__beam startup-splash__beam_orange" />
      <span className="startup-splash__beam startup-splash__beam_teal" />
      <span className="startup-splash__particle startup-splash__particle_1" />
      <span className="startup-splash__particle startup-splash__particle_2" />
      <span className="startup-splash__particle startup-splash__particle_3" />
      <span className="startup-splash__particle startup-splash__particle_4" />
      <span className="startup-splash__particle startup-splash__particle_5" />
    </div>
    <div className="startup-splash__panel">
      <div className="startup-splash__eyebrow">CalcPro</div>
      <div className="startup-splash__mark" aria-hidden="true">
        <span className="startup-splash__halo startup-splash__halo_outer" />
        <span className="startup-splash__halo startup-splash__halo_inner" />
        <span className="startup-splash__glow startup-splash__glow_left" />
        <span className="startup-splash__glow startup-splash__glow_right" />
        <span className="startup-splash__scanline" />
        <span className="startup-splash__orbit startup-splash__orbit_outer">
          <span className="startup-splash__satellite startup-splash__satellite_orange" />
        </span>
        <span className="startup-splash__orbit startup-splash__orbit_mid">
          <span className="startup-splash__satellite startup-splash__satellite_teal" />
        </span>
        <span className="startup-splash__orbit startup-splash__orbit_inner">
          <span className="startup-splash__satellite startup-splash__satellite_light" />
        </span>
        <span className="startup-splash__core-shell">
          <span className="startup-splash__core">
            <img className="startup-splash__logo-image" src={calcProLogo} alt="" aria-hidden="true" />
          </span>
        </span>
        <span className="startup-splash__pedestal" />
      </div>
      <h1 className="startup-splash__title">Подготавливаем калькулятор</h1>
      <p className="startup-splash__text">
        Шаблоны, настройки и рабочий контекст сообщества уже на подходе.
      </p>
      <div className="startup-splash__status-row" aria-hidden="true">
        <span className="startup-splash__status-pill">Шаблоны</span>
        <span className="startup-splash__status-pill">Аналитика</span>
        <span className="startup-splash__status-pill">VK</span>
      </div>
      <div className="startup-splash__wave" aria-hidden="true">
        <span className="startup-splash__wave-bar" />
        <span className="startup-splash__wave-bar" />
        <span className="startup-splash__wave-bar" />
        <span className="startup-splash__wave-bar" />
        <span className="startup-splash__wave-bar" />
        <span className="startup-splash__wave-bar" />
        <span className="startup-splash__wave-bar" />
        <span className="startup-splash__wave-bar" />
        <span className="startup-splash__wave-bar" />
        <span className="startup-splash__wave-bar" />
        <span className="startup-splash__wave-bar" />
        <span className="startup-splash__wave-bar" />
      </div>
    </div>
  </div>
);

const COMMUNITY_ADMIN_ROLES = new Set(['admin', 'editor', 'moder']);
const DEFAULT_FOLDER_NAME = 'Новая папка';

const parsePositiveInteger = (rawValue: string | null | undefined) => {
  const value = Number(rawValue);
  return Number.isInteger(value) && value > 0 ? value : 0;
};

const parseCommunityIdFromInstallResult = (result: unknown) => {
  if (!result || typeof result !== 'object') {
    return 0;
  }

  const payload = result as {
    group_id?: number | string;
    groupId?: number | string;
    group_ids?: Array<number | string>;
    groupIds?: Array<number | string>;
    group?: { id?: number | string };
  };

  return (
    parsePositiveInteger(payload.group_id != null ? String(payload.group_id) : null) ||
    parsePositiveInteger(payload.groupId != null ? String(payload.groupId) : null) ||
    parsePositiveInteger(payload.group?.id != null ? String(payload.group.id) : null) ||
    parsePositiveInteger(
      Array.isArray(payload.group_ids) && payload.group_ids.length > 0
        ? String(payload.group_ids[0])
        : null,
    ) ||
    parsePositiveInteger(
      Array.isArray(payload.groupIds) && payload.groupIds.length > 0
        ? String(payload.groupIds[0])
        : null,
    )
  );
};

const parseCommunityIdFromUserInput = (rawValue: string | null | undefined) => {
  const normalized = String(rawValue || '').trim();
  if (!normalized) {
    return 0;
  }

  const directId = parsePositiveInteger(normalized);
  if (directId > 0) {
    return directId;
  }

  const match = normalized.match(/(?:club|public|event)?([1-9]\d{2,})/i);
  return match ? Number(match[1]) : 0;
};

const createFallbackCommunity = (
  groupId: number,
  role: string,
): CalculatorConnectedCommunity | null => {
  if (groupId <= 0) {
    return null;
  }

  const timestamp = new Date().toISOString();
  return {
    groupId,
    name: `Сообщество ${groupId}`,
    screenName: '',
    photoUrl: '',
    role,
    addedAt: timestamp,
    lastUsedAt: timestamp,
  };
};

const scopeCommunitiesToContext = (
  communities: CalculatorConnectedCommunity[],
  launchGroupId: number,
  fallbackCommunity: CalculatorConnectedCommunity | null,
) => {
  if (communities.length > 0) {
    const unique = new Map<number, CalculatorConnectedCommunity>();
    communities.forEach((community) => {
      unique.set(community.groupId, community);
    });

    if (launchGroupId > 0 && fallbackCommunity && !unique.has(launchGroupId)) {
      unique.set(launchGroupId, fallbackCommunity);
    }

    return [...unique.values()].sort(
      (left, right) =>
        new Date(right.lastUsedAt).getTime() - new Date(left.lastUsedAt).getTime(),
    );
  }

  return fallbackCommunity ? [fallbackCommunity] : [];
};

const getMonthRequestCount = (
  requests: CalculatorRequest[],
  quotaStartedAt?: string,
  date = new Date(),
) => {
  const month = date.getMonth();
  const year = date.getFullYear();
  const quotaStartTimestamp = Date.parse(quotaStartedAt || '');

  return requests.filter((request) => {
    const createdAt = new Date(request.createdAt);
    if (createdAt.getMonth() !== month || createdAt.getFullYear() !== year) {
      return false;
    }

    if (Number.isFinite(quotaStartTimestamp) && createdAt.getTime() < quotaStartTimestamp) {
      return false;
    }

    return true;
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

const appendRequestHistoryEntry = (
  request: CalculatorRequest,
  entry: Omit<CalculatorRequestHistoryEntry, 'id' | 'createdAt'> & { createdAt?: string },
) => [
  ...(request.history ?? []),
  {
    id: createRandomId(),
    createdAt: entry.createdAt ?? new Date().toISOString(),
    ...entry,
  },
];

const App = () => {
  const [activeView, setActiveView] = useState<AppView>('calculator');
  const [templates, setTemplates] = useState<CalculatorTemplate[]>(() => getTemplates());
  const [folders, setFolders] = useState<CalculatorFolder[]>(() => getFolders());
  const [requests, setRequests] = useState<CalculatorRequest[]>(() => getRequests());
  const [analyticsEvents, setAnalyticsEvents] = useState<CalculatorAnalyticsEvent[]>([]);
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
  const [liveSyncRevision, setLiveSyncRevision] = useState(0);
  const [isCommunitiesLoading, setIsCommunitiesLoading] = useState(true);
  const [isTemplatesLoading, setIsTemplatesLoading] = useState(true);
  const [isStartupSplashVisible, setIsStartupSplashVisible] = useState(true);
  const [hasStartupDelayElapsed, setHasStartupDelayElapsed] = useState(false);
  const [isLaunchParamsResolved, setIsLaunchParamsResolved] = useState(false);
  const [isInitialViewResolved, setIsInitialViewResolved] = useState(false);
  const [isDesktopClient, setIsDesktopClient] = useState(true);
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const [launchParams, setLaunchParams] = useState<Partial<GetLaunchParamsResponse> | null>(() => {
    if (typeof window === 'undefined') {
      return null;
    }

    try {
      return {
        ...getWindowLaunchParams(),
        ...parseURLSearchParamsForGetLaunchParams(window.location.search),
      };
    } catch {
      return getWindowLaunchParams();
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
  const monthlyRequestsUsed = useMemo(
    () =>
      getSubscriptionMonthlyUsage(adminSettings.subscription) ??
      getMonthRequestCount(requests, adminSettings.subscription.quotaStartedAt),
    [adminSettings.subscription, requests],
  );
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
  const isPublicViewer = !isViewerGroupAdmin;
  const launchPlatform = String(launchParams?.vk_platform || '');
  const isWebMonetizationPlatform =
    WEB_MONETIZATION_PLATFORMS.has(launchPlatform) ||
    (launchPlatform === '' && !bridge.isWebView());
  const vkAuthHeaders = useMemo(() => createVkAuthHeaders(launchParams), [launchParams]);
  const createApiUrl = (path: string) => appendVkLaunchParamsToPath(path, launchParams);
  const fallbackCommunity = useMemo(
    () => (isViewerGroupAdmin ? createFallbackCommunity(currentGroupId, viewerGroupRole) : null),
    [currentGroupId, isViewerGroupAdmin, viewerGroupRole],
  );
  const createJsonHeaders = () => ({
    'Content-Type': 'application/json',
    ...vkAuthHeaders,
  });
  const isProtectedApiUnavailable = (payload?: { error?: string } | null, status?: number) =>
    isVkLaunchParamsError(payload, status);
  const templatesSyncVersionRef = useRef(0);
  const templatesRef = useRef(templates);
  const selectedTemplateRef = useRef(selectedTemplate);

  useEffect(() => {
    templatesRef.current = templates;
  }, [templates]);

  useEffect(() => {
    selectedTemplateRef.current = selectedTemplate;
  }, [selectedTemplate]);

  useEffect(() => {
    setStorageGroupScope(effectiveAdminGroupId);
    setTemplates(getTemplates());
    setFolders(getFolders());
    setRequests(getRequests());
    setAnalyticsEvents([]);
    setAdminSettings(getAdminSettings());
    setSelectedTemplate(undefined);
    setActiveFolderId('all');
    templatesSyncVersionRef.current += 1;
  }, [effectiveAdminGroupId]);

  useEffect(() => {
    if (!isLaunchParamsResolved || isPublicViewer) {
      return;
    }

    const triggerLiveSync = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }

      setLiveSyncRevision((current) => current + 1);
    };

    const intervalId = window.setInterval(triggerLiveSync, 10000);
    window.addEventListener('focus', triggerLiveSync);
    document.addEventListener('visibilitychange', triggerLiveSync);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', triggerLiveSync);
      document.removeEventListener('visibilitychange', triggerLiveSync);
    };
  }, [isLaunchParamsResolved, isPublicViewer]);

  useEffect(() => {
    if (currentGroupId > 0 && activeAdminGroupId === 0) {
      setActiveAdminGroupId(currentGroupId);
    }
  }, [activeAdminGroupId, currentGroupId]);

  useEffect(() => {
    if (isViewerGroupAdmin) {
      void preloadHomePage().catch(() => undefined);
    }
  }, [isViewerGroupAdmin]);

  useEffect(() => {
    if (selectedTemplate) {
      void preloadCalculatorPage().catch(() => undefined);
    }
  }, [selectedTemplate]);

  useEffect(() => {
    if (isPublicViewer) {
      return;
    }

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
  }, [isPublicViewer]);

  useEffect(() => {
    let isCancelled = false;

    bridge
      .send('VKWebAppGetLaunchParams')
      .then((params) => {
        if (isCancelled) {
          return;
        }

        setLaunchParams((currentParams) => ({
          ...(currentParams ?? {}),
          ...getWindowLaunchParams(),
          ...params,
        }));
        setIsLaunchParamsResolved(true);
      })
      .catch(() => {
        if (isCancelled) {
          return;
        }

        // Keep launch params parsed from the current URL when bridge params
        // are unavailable, for example during desktop VK embedding quirks.
        setLaunchParams((currentParams) => ({
          ...(currentParams ?? {}),
          ...getWindowLaunchParams(),
        }));
        setIsLaunchParamsResolved(true);
      });

    return () => {
      isCancelled = true;
    };
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
    const timeoutId = window.setTimeout(() => {
      setHasStartupDelayElapsed(true);
    }, 1400);

    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (!isStartupSplashVisible) {
      return;
    }

    if (
      hasStartupDelayElapsed &&
      !isTemplatesLoading &&
      isLaunchParamsResolved &&
      isInitialViewResolved
    ) {
      setIsStartupSplashVisible(false);
    }
  }, [
    hasStartupDelayElapsed,
    isInitialViewResolved,
    isLaunchParamsResolved,
    isStartupSplashVisible,
    isTemplatesLoading,
  ]);

  useEffect(() => {
    if (!isLaunchParamsResolved) {
      return;
    }

    if (isPublicViewer) {
      setConnectedCommunities([]);
      setIsCommunitiesLoading(false);
      return;
    }

    let isCancelled = false;
    if (liveSyncRevision === 0) {
      setIsCommunitiesLoading(true);
    }

    const syncCommunities = async () => {
      try {
        if (currentGroupId > 0) {
          const connectedResponse = await fetch(createApiUrl('/api/communities'), {
            method: 'POST',
            headers: createJsonHeaders(),
            body: JSON.stringify({
              groupId: currentGroupId,
              name: `Сообщество ${currentGroupId}`,
              role: viewerGroupRole,
              workspacePlan: currentPlan.id,
            }),
          });
          const connectedPayload = (await connectedResponse.json().catch(() => null)) as
            | { ok?: boolean; data?: CalculatorConnectedCommunity[]; error?: string }
            | null;

          if (isProtectedApiUnavailable(connectedPayload, connectedResponse.status)) {
            if (!isCancelled && fallbackCommunity) {
              setConnectedCommunities([fallbackCommunity]);
            }
            return;
          }

          if (!isCancelled && connectedResponse.ok && connectedPayload?.ok && Array.isArray(connectedPayload.data)) {
            setConnectedCommunities(
              scopeCommunitiesToContext(connectedPayload.data, currentGroupId, fallbackCommunity),
            );
            return;
          }
        }

        const response = await fetch(createApiUrl('/api/communities'), {
          headers: vkAuthHeaders,
        });
        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; data?: CalculatorConnectedCommunity[]; error?: string }
          | null;

        if (isProtectedApiUnavailable(payload, response.status)) {
          if (!isCancelled && fallbackCommunity) {
            setConnectedCommunities([fallbackCommunity]);
          }
          return;
        }

        if (!isCancelled && response.ok && payload?.ok && Array.isArray(payload.data)) {
          setConnectedCommunities(
            scopeCommunitiesToContext(
              payload.data.length === 0 && fallbackCommunity ? [fallbackCommunity] : payload.data,
              currentGroupId,
              fallbackCommunity,
            ),
          );
        }
      } catch {
        if (!isCancelled && fallbackCommunity) {
          setConnectedCommunities([fallbackCommunity]);
        }
      } finally {
        if (!isCancelled) {
          setIsCommunitiesLoading(false);
        }
      }
    };

    syncCommunities();

    return () => {
      isCancelled = true;
    };
  }, [
    currentGroupId,
    currentPlan.id,
    viewerGroupRole,
    fallbackCommunity,
    isLaunchParamsResolved,
    isPublicViewer,
    liveSyncRevision,
  ]);

  useEffect(() => {
    if (!isLaunchParamsResolved) {
      return;
    }

    if (isPublicViewer) {
      return;
    }

    let isCancelled = false;

    const syncAdminSettings = async () => {
      try {
        const query = effectiveAdminGroupId > 0 ? `?groupId=${effectiveAdminGroupId}` : '';
        const response = await fetch(createApiUrl(`/api/admin-settings${query}`), {
          headers: vkAuthHeaders,
        });
        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; data?: CalculatorAdminSettings; error?: string }
          | null;

        if (isProtectedApiUnavailable(payload, response.status)) {
          return;
        }

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
  }, [effectiveAdminGroupId, isLaunchParamsResolved, isPublicViewer, liveSyncRevision]);

  useEffect(() => {
    if (!isLaunchParamsResolved) {
      return;
    }

    let isCancelled = false;
    const syncVersion = templatesSyncVersionRef.current;
    setIsTemplatesLoading(true);

    const syncTemplatesFromServer = async () => {
      try {
        const query = effectiveAdminGroupId > 0 ? `?groupId=${effectiveAdminGroupId}` : '';
        const response = await fetch(createApiUrl(`/api/templates${query}`), {
          headers: vkAuthHeaders,
        });
        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; data?: CalculatorTemplate[]; error?: string }
          | null;

        if (isProtectedApiUnavailable(payload, response.status)) {
          return;
        }

        if (
          !response.ok ||
          !payload?.ok ||
          !Array.isArray(payload.data) ||
          isCancelled ||
          templatesSyncVersionRef.current !== syncVersion
        ) {
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
          fetch(createApiUrl(`/api/templates${query}`), {
            method: 'POST',
            headers: createJsonHeaders(),
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
      } finally {
        if (!isCancelled && templatesSyncVersionRef.current === syncVersion) {
          setIsTemplatesLoading(false);
        }
      }
    };

    syncTemplatesFromServer();

    return () => {
      isCancelled = true;
    };
  }, [effectiveAdminGroupId, isLaunchParamsResolved, vkAuthHeaders]);

  useEffect(() => {
    if (!isLaunchParamsResolved) {
      return;
    }

    if (!isViewerGroupAdmin) {
      return;
    }

    let isCancelled = false;
    const localRequests = getRequests();

    const syncRequestsFromServer = async () => {
      try {
        const query = effectiveAdminGroupId > 0 ? `?groupId=${effectiveAdminGroupId}` : '';
        const response = await fetch(createApiUrl(`/api/requests${query}`), {
          headers: vkAuthHeaders,
        });
        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; data?: CalculatorRequest[]; error?: string }
          | null;

        if (isProtectedApiUnavailable(payload, response.status)) {
          return;
        }

        if (!response.ok || !payload?.ok || !Array.isArray(payload.data) || isCancelled) {
          return;
        }

        const serverRequests = payload.data;
        const missingLocalRequests = localRequests.filter(
          (localRequest) =>
            !serverRequests.some((serverRequest) => serverRequest.id === localRequest.id),
        );

        if (missingLocalRequests.length > 0) {
          const syncResponse = await fetch(createApiUrl(`/api/requests${query}&action=sync`.replace('?&', '?')), {
            method: 'POST',
            headers: createJsonHeaders(),
            body: JSON.stringify({
              groupId: effectiveAdminGroupId,
              requests: missingLocalRequests,
            }),
          });
          const syncPayload = (await syncResponse.json().catch(() => null)) as
            | { ok?: boolean; data?: CalculatorRequest[]; error?: string }
            | null;

          if (
            syncResponse.ok &&
            syncPayload?.ok &&
            Array.isArray(syncPayload.data) &&
            !isCancelled
          ) {
            persistRequests(syncPayload.data);
          }

          return;
        }

        persistRequests(serverRequests);
      } catch {
        // Keep local requests as a fallback when API is unavailable.
      }
    };

    syncRequestsFromServer();

    return () => {
      isCancelled = true;
    };
  }, [
    effectiveAdminGroupId,
    isLaunchParamsResolved,
    isViewerGroupAdmin,
    liveSyncRevision,
    vkAuthHeaders,
  ]);

  useEffect(() => {
    if (!isLaunchParamsResolved) {
      return;
    }

    if (!isViewerGroupAdmin) {
      return;
    }

    let isCancelled = false;

    const syncAnalyticsFromServer = async () => {
      try {
        const query = effectiveAdminGroupId > 0 ? `?groupId=${effectiveAdminGroupId}` : '';
        const response = await fetch(createApiUrl(`/api/analytics${query}`), {
          headers: vkAuthHeaders,
        });
        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; data?: CalculatorAnalyticsEvent[]; error?: string }
          | null;

        if (isProtectedApiUnavailable(payload, response.status)) {
          return;
        }

        if (!response.ok || !payload?.ok || !Array.isArray(payload.data) || isCancelled) {
          return;
        }

        setAnalyticsEvents(payload.data);
      } catch {
        // Keep analytics empty when the API is unavailable.
      }
    };

    syncAnalyticsFromServer();

    return () => {
      isCancelled = true;
    };
  }, [
    effectiveAdminGroupId,
    isLaunchParamsResolved,
    isViewerGroupAdmin,
    liveSyncRevision,
    vkAuthHeaders,
  ]);

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
      setIsInitialViewResolved(true);
      return;
    }

    if (!isLaunchParamsResolved || isTemplatesLoading) {
      return;
    }

    if (
      activeView === 'builder' ||
      (activeView === 'calculator' &&
        selectedTemplate != null &&
        selectedTemplate.publicationStatus !== 'published')
    ) {
      setIsInitialViewResolved(true);
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

      setIsInitialViewResolved(true);
      return;
    }

    if (!isViewerGroupAdmin) {
      setSelectedTemplate(undefined);
      setActiveView('calculator');
    }

    setIsInitialViewResolved(true);
  }, [
    activeView,
    isLaunchParamsResolved,
    isTemplatesLoading,
    isViewerGroupAdmin,
    latestPublishedTemplate,
    selectedTemplate,
    templates,
  ]);

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

  const createTemplateFromCatalog = async (presetId: string) => {
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

    const { createTemplateFromPreset } = await import('./entities/calculator/templateCatalog');
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

    fetch(createApiUrl(`/api/admin-settings${query}`), {
      method: 'POST',
      headers: createJsonHeaders(),
      body: JSON.stringify(settings),
    }).catch(() => {
      // Local settings remain saved even if the API request fails.
    });
  };

  const handleExportRequestsToGoogleSheets = async () => {
    if (!isViewerGroupAdmin || effectiveAdminGroupId <= 0) {
      return {
        ok: false,
        message: 'Откройте приложение внутри нужного сообщества VK.',
      };
    }

    try {
      const query = `?groupId=${effectiveAdminGroupId}&action=export-google-sheets`;
      const response = await fetch(createApiUrl(`/api/requests${query}`), {
        method: 'POST',
        headers: createJsonHeaders(),
        body: JSON.stringify({
          groupId: effectiveAdminGroupId,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; message?: string; settings?: CalculatorAdminSettings }
        | null;

      if (isProtectedApiUnavailable(payload, response.status)) {
        return {
          ok: false,
          message: getVkLaunchParamsErrorMessage(payload, response.status),
        };
      }

      if (!response.ok || !payload?.ok) {
        return {
          ok: false,
          message: payload?.error || payload?.message || 'Не удалось выгрузить заявки в Google Sheets.',
        };
      }

      if (payload.settings) {
        persistAdminSettings(payload.settings);
      }

      return {
        ok: true,
        message: payload.message || 'Заявки отправлены в Google Sheets.',
      };
    } catch {
      return {
        ok: false,
        message: 'Не удалось выгрузить заявки в Google Sheets.',
      };
    }
  };

  const handleGrantProAccess = async (
    targetGroupId: number,
    plan: CalculatorSubscriptionPlan,
    days = 30,
  ) => {
    if (!isSuperAdmin || !adminProfile.id || targetGroupId <= 0) {
      return {
        ok: false,
        message: 'Недостаточно прав для выдачи доступа.',
      };
    }

    try {
      const response = await fetch(createApiUrl('/api/admin-settings?action=grant-pro'), {
        method: 'POST',
        headers: createJsonHeaders(),
        body: JSON.stringify({
          targetGroupId,
          plan,
          days,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; data?: CalculatorAdminSettings; error?: string }
        | null;

      if (isProtectedApiUnavailable(payload, response.status)) {
        return {
          ok: false,
          message: getVkLaunchParamsErrorMessage(payload, response.status),
        };
      }

      if (!response.ok || !payload?.ok || !payload.data) {
        throw new Error(payload?.error || 'Не удалось выдать доступ к тарифу.');
      }

      if (targetGroupId === effectiveAdminGroupId) {
        persistAdminSettings(payload.data);
      }

      return {
        ok: true,
        message: `Тариф ${getSubscriptionPlanConfig(plan).name} выдан для группы ${targetGroupId}.`,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Не удалось выдать доступ к тарифу.',
      };
    }
  };

  const handleResetAllGroups = async (confirmation: string) => {
    if (!isSuperAdmin || !adminProfile.id) {
      return {
        ok: false,
        message: 'Недостаточно прав для полного сброса.',
        clearedGroupIds: [],
      };
    }

    try {
      const response = await fetch(createApiUrl('/api/admin-settings?action=reset-all-groups'), {
        method: 'POST',
        headers: createJsonHeaders(),
        body: JSON.stringify({
          confirmation,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            data?: { clearedGroupIds?: number[]; matchedKeys?: number };
            error?: string;
          }
        | null;

      if (!response.ok || !payload?.ok || !payload.data) {
        throw new Error(payload?.error || 'Не удалось выполнить массовый сброс.');
      }

      resetAllCalcProStorage();
      setConnectedCommunities([]);
      setTemplates([]);
      setFolders([]);
      setRequests([]);
      setAdminSettings(getAdminSettings());
      setSelectedTemplate(undefined);
      setActiveFolderId('all');
      setActiveAdminGroupId(currentGroupId > 0 ? currentGroupId : 0);
      setPaymentStatus({
        tone: 'success',
        message: `Сброс выполнен. Очищено групп: ${payload.data.clearedGroupIds?.length ?? 0}, ключей: ${payload.data.matchedKeys ?? 0}.`,
      });

      return {
        ok: true,
        message: `Очищено групп: ${payload.data.clearedGroupIds?.length ?? 0}.`,
        clearedGroupIds: payload.data.clearedGroupIds ?? [],
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Не удалось выполнить массовый сброс.',
        clearedGroupIds: [],
      };
    }
  };

  const handleResetGroup = async (targetGroupId: number, confirmation: string) => {
    if (!isSuperAdmin || !adminProfile.id || targetGroupId <= 0) {
      return {
        ok: false,
        message: 'Недостаточно прав для сброса группы.',
      };
    }

    try {
      const response = await fetch(createApiUrl('/api/admin-settings?action=reset-group'), {
        method: 'POST',
        headers: createJsonHeaders(),
        body: JSON.stringify({
          targetGroupId,
          confirmation,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            data?: { groupId?: number; matchedKeys?: number; clearedViewerBuckets?: number };
            error?: string;
          }
        | null;

      if (!response.ok || !payload?.ok || !payload.data) {
        throw new Error(payload?.error || 'Не удалось выполнить сброс группы.');
      }

      setConnectedCommunities((current) =>
        current.filter((community) => community.groupId !== targetGroupId),
      );

      if (targetGroupId === effectiveAdminGroupId) {
        resetCalcProStorageForGroup(targetGroupId);
        setTemplates(getTemplates());
        setFolders(getFolders());
        setRequests(getRequests());
        setAdminSettings(getAdminSettings());
        setSelectedTemplate(undefined);
        setActiveFolderId('all');
      }

      setPaymentStatus({
        tone: 'success',
        message: `Сброс группы ${targetGroupId} выполнен. Очищено ключей: ${payload.data.matchedKeys ?? 0}.`,
      });

      return {
        ok: true,
        message: `Группа ${targetGroupId} очищена.`,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Не удалось выполнить сброс группы.',
      };
    }
  };

  const persistAdminSettings = (settings: CalculatorAdminSettings) => {
    saveAdminSettings(settings);
    setAdminSettings(settings);
  };

  const persistRequests = (nextRequests: CalculatorRequest[]) => {
    saveRequests(nextRequests);
    setRequests(nextRequests);
  };

  const syncTemplatesToServer = async (nextTemplates: CalculatorTemplate[]) => {
    const query = effectiveAdminGroupId > 0 ? `?groupId=${effectiveAdminGroupId}` : '';
    const response = await fetch(createApiUrl(`/api/templates${query}`), {
      method: 'POST',
      headers: createJsonHeaders(),
      body: JSON.stringify({
        groupId: effectiveAdminGroupId,
        templates: nextTemplates,
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; data?: CalculatorTemplate[]; error?: string }
      | null;

    if (isProtectedApiUnavailable(payload, response.status)) {
      throw new Error(
        'Откройте приложение внутри нужного сообщества VK и повторите публикацию.',
      );
    }

    if (!response.ok || !payload?.ok || !Array.isArray(payload.data)) {
      throw new Error(payload?.error || 'Не удалось сохранить калькулятор на сервере.');
    }

    return payload.data.map((template) => normalizeTemplateRecord(template));
  };

  const persistTemplates = (nextTemplates: CalculatorTemplate[]) => {
    templatesSyncVersionRef.current += 1;
    templatesRef.current = nextTemplates;
    saveTemplates(nextTemplates);
    setTemplates(nextTemplates);

    syncTemplatesToServer(nextTemplates).catch(() => {
      // Local templates remain saved even if the API request fails.
    });
  };

  const syncRequestPatchToServer = (requestId: string, patch: Partial<CalculatorRequest>) => {
    const query =
      effectiveAdminGroupId > 0
        ? `?groupId=${effectiveAdminGroupId}&action=update`
        : '?action=update';

    fetch(createApiUrl(`/api/requests${query}`), {
      method: 'POST',
      headers: createJsonHeaders(),
      body: JSON.stringify({
        groupId: effectiveAdminGroupId,
        requestId,
        patch,
      }),
    })
      .then((response) => response.json().catch(() => null))
      .then((payload: { ok?: boolean; data?: CalculatorRequest[] } | null) => {
        if (payload?.ok && Array.isArray(payload.data)) {
          persistRequests(payload.data);
        }
      })
      .catch(() => {
        // Keep local request changes when server sync fails.
      });
  };

  const updateRequestWithHistory = (
    requestId: string,
    buildPatch: (request: CalculatorRequest) => Partial<CalculatorRequest> | null,
  ) => {
    const currentRequest = requests.find((request) => request.id === requestId);
    if (!currentRequest) {
      return;
    }

    const patch = buildPatch(currentRequest);
    if (!patch) {
      return;
    }

    const next = updateRequest(requestId, patch);
    setRequests(next);
    syncRequestPatchToServer(requestId, patch);
  };

  const handleUpdateRequestStatus = (
    requestId: string,
    status: CalculatorRequest['status'],
  ) => {
    updateRequestWithHistory(requestId, (request) => {
      if (request.status === status) {
        return null;
      }

      return {
        status,
        updatedAt: new Date().toISOString(),
        history: appendRequestHistoryEntry(request, {
          type: 'status_changed',
          message: `Статус изменён: ${request.status} -> ${status}`,
          author: currentAdminLabel,
        }),
      };
    });
  };

  const handleUpdateRequest = (
    requestId: string,
    patch: Partial<
      Pick<
        CalculatorRequest,
        'name' | 'phone' | 'comment' | 'amount' | 'status' | 'assignedTo' | 'updatedAt'
      >
    > & {
      internalComments?: CalculatorRequest['internalComments'];
      history?: CalculatorRequest['history'];
    },
  ) => {
    updateRequestWithHistory(requestId, (request) => {
      const updatedAt = patch.updatedAt ?? new Date().toISOString();
      const nextPatch: Partial<CalculatorRequest> = {
        ...patch,
        updatedAt,
      };
      const history: CalculatorRequestHistoryEntry[] = [];
      const hasChanged =
        ('assignedTo' in patch && (patch.assignedTo ?? '') !== (request.assignedTo ?? '')) ||
        ('name' in patch && patch.name !== request.name) ||
        ('phone' in patch && patch.phone !== request.phone) ||
        ('comment' in patch && patch.comment !== request.comment) ||
        ('amount' in patch && patch.amount !== request.amount) ||
        ('status' in patch && patch.status !== request.status) ||
        ('internalComments' in patch &&
          JSON.stringify(patch.internalComments ?? []) !==
            JSON.stringify(request.internalComments ?? [])) ||
        ('history' in patch &&
          JSON.stringify(patch.history ?? []) !== JSON.stringify(request.history ?? []));

      if (!hasChanged) {
        return null;
      }

      if ('assignedTo' in patch && (patch.assignedTo ?? '') !== (request.assignedTo ?? '')) {
        history.push({
          id: createRandomId(),
          type: 'assigned',
          message: patch.assignedTo
            ? `Ответственный назначен: ${patch.assignedTo}`
            : 'Ответственный снят',
          author: currentAdminLabel,
          createdAt: updatedAt,
        });
      }

      if (
        ('name' in patch && patch.name !== request.name) ||
        ('phone' in patch && patch.phone !== request.phone) ||
        ('comment' in patch && patch.comment !== request.comment) ||
        ('amount' in patch && patch.amount !== request.amount)
      ) {
        history.push({
          id: createRandomId(),
          type: 'updated',
          message: 'Карточка заявки обновлена',
          author: currentAdminLabel,
          createdAt: updatedAt,
        });
      }

      if ('status' in patch && patch.status && patch.status !== request.status) {
        history.push({
          id: createRandomId(),
          type: 'status_changed',
          message: `Статус изменён: ${request.status} -> ${patch.status}`,
          author: currentAdminLabel,
          createdAt: updatedAt,
        });
      }

      if (history.length > 0) {
        nextPatch.history = [...(request.history ?? []), ...history];
      }

      return nextPatch;
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
    let addedGroupId = 0;

    try {
      const result = (await bridge.send('VKWebAppAddToCommunity' as never, {
        hide_success_modal: false,
      } as never)) as unknown;
      addedGroupId = parseCommunityIdFromInstallResult(result);
    } catch {
      setHomeSection('payments');
      setPaymentStatus({
        tone: 'neutral',
        message:
          'Не удалось открыть выбор сообщества автоматически. Откройте приложение из нужной группы VK и повторите установку там.',
      });
      return;
    }

    if (addedGroupId === 0 && typeof window !== 'undefined') {
      const manualGroupInput = window.prompt(
        'VK не вернул ID выбранного сообщества. Вставьте ссылку на группу или её ID, чтобы добавить сообщество в кабинет.',
        '',
      );

      const manuallyResolvedGroupId = parseCommunityIdFromUserInput(manualGroupInput);
      if (manuallyResolvedGroupId > 0) {
        addedGroupId = manuallyResolvedGroupId;
      } else if (manualGroupInput?.trim()) {
        try {
          const resolveResponse = await fetch(createApiUrl('/api/communities?action=resolve'), {
            method: 'POST',
            headers: createJsonHeaders(),
            body: JSON.stringify({
              community: manualGroupInput.trim(),
            }),
          });
          const resolvePayload = (await resolveResponse.json().catch(() => null)) as
            | {
                ok?: boolean;
                data?: { groupId?: number; name?: string; screenName?: string; photoUrl?: string };
                error?: string;
              }
            | null;

          if (
            resolveResponse.ok &&
            resolvePayload?.ok &&
            Number(resolvePayload.data?.groupId) > 0
          ) {
            addedGroupId = Number(resolvePayload.data?.groupId);
          } else if (resolvePayload?.error) {
            setPaymentStatus({
              tone: 'error',
              message: resolvePayload.error,
            });
          }
        } catch {
          setPaymentStatus({
            tone: 'error',
            message: 'Не удалось распознать сообщество по ссылке. Укажите числовой ID группы.',
          });
        }
      }
    }

    if (addedGroupId === 0) {
      setHomeSection('communities');
      setPaymentStatus((current) =>
        current ?? {
          tone: 'neutral',
          message:
            'Не удалось определить добавленное сообщество. Вставьте числовой ID группы или откройте приложение уже из нужного сообщества VK.',
        },
      );
      return;
    }

    try {
      if (addedGroupId > 0) {
        const response = await fetch(createApiUrl('/api/communities'), {
          method: 'POST',
          headers: createJsonHeaders(),
          body: JSON.stringify({
            groupId: addedGroupId,
            workspaceGroupId: currentGroupId,
            role: viewerGroupRole,
            workspacePlan: currentPlan.id,
            platform: launchParams?.vk_platform ?? '',
            notifyConnect: true,
          }),
        });
        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; data?: CalculatorConnectedCommunity[]; error?: string }
          | null;

        if (isProtectedApiUnavailable(payload, response.status)) {
          setPaymentStatus(null);
          return;
        }

        if (!response.ok || !payload?.ok || !Array.isArray(payload.data)) {
          throw new Error(
            payload?.error ||
              `Сервис добавлен в группу ID ${addedGroupId}, но не удалось сохранить её в кабинете.`,
          );
        }

        setConnectedCommunities(
          scopeCommunitiesToContext(payload.data, currentGroupId, fallbackCommunity),
        );
      }

      setHomeSection('communities');
      setPaymentStatus(
        addedGroupId > 0
          ? {
              tone: 'success',
              message: `Приложение добавлено в сообщество ID ${addedGroupId}. Группа уже подключена к кабинету.`,
            }
          : {
              tone: 'neutral',
              message:
                'VK не вернул ID выбранной группы. Откройте приложение из добавленного сообщества, и оно автоматически появится в списке.',
            },
      );
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

    if (!isWebMonetizationPlatform) {
      setActiveView('home');
      setHomeSection('payments');
      setPaymentStatus({
        tone: 'neutral',
        message: 'Оплата на платформе недоступна.',
      });
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
      const response = await fetch(createApiUrl('/api/yookassa?action=create'), {
        method: 'POST',
        headers: createJsonHeaders(),
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

      if (isProtectedApiUnavailable(payload, response.status)) {
        setPaymentStatus(null);
        setIsProcessingPayment(false);
        return;
      }

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

    if (!isWebMonetizationPlatform) {
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    const paymentIdFromUrl = searchParams.get('paymentId');
    const pendingPayment = readPendingPayment();

    if (hasActiveSubscription && currentPlan.id !== 'free') {
      if (paymentIdFromUrl || pendingPayment?.paymentId) {
        clearPendingPayment();
        clearPaymentIdFromUrl();
      }
      return;
    }

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
        const response = await fetch(createApiUrl('/api/yookassa?action=check'), {
          method: 'POST',
          headers: createJsonHeaders(),
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

        if (isProtectedApiUnavailable(payload, response.status)) {
          clearPendingPayment();
          clearPaymentIdFromUrl();
          setPaymentStatus(null);
          setIsProcessingPayment(false);
          return;
        }

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
  }, [
    adminSettings,
    currentPlan.id,
    effectiveAdminGroupId,
    hasActiveSubscription,
    isWebMonetizationPlatform,
    paidPlanConfig.id,
  ]);

  const handleSaveTemplate = (template: CalculatorTemplate) => {
    if (!isViewerGroupAdmin) {
      return;
    }

    const storedTemplate = templatesRef.current.find((item) => item.id === template.id);
    const normalizedTemplate = normalizeTemplateRecord({
      ...storedTemplate,
      ...template,
      title: clampTemplateTitle(template.title),
      description: clampTemplateDescription(template.description),
      publicationStatus: storedTemplate?.publicationStatus ?? template.publicationStatus,
      publishedAt: storedTemplate?.publishedAt ?? template.publishedAt,
      publicId: storedTemplate?.publicId ?? template.publicId,
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
      id: createRandomId(),
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
        id: createRandomId(),
        options: field.options?.map((option) => ({
          ...option,
          id: createRandomId(),
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

  const handleDeleteRequest = (requestId: string) => {
    if (!isViewerGroupAdmin) {
      return;
    }

    const next = deleteRequest(requestId);
    setRequests(next);

    const query = effectiveAdminGroupId > 0 ? `?groupId=${effectiveAdminGroupId}&action=delete` : '?action=delete';
    fetch(createApiUrl(`/api/requests${query}`), {
      method: 'POST',
      headers: createJsonHeaders(),
      body: JSON.stringify({
        groupId: effectiveAdminGroupId,
        requestId,
      }),
    })
      .then((response) => response.json().catch(() => null))
      .then((payload: { ok?: boolean; data?: CalculatorRequest[] } | null) => {
        if (payload?.ok && Array.isArray(payload.data)) {
          persistRequests(payload.data);
        }
      })
      .catch(() => {
        // Keep local deletion when server sync fails.
      });
  };

  const updateTemplatePublicationStatus = async (
    template: CalculatorTemplate,
    publicationStatus: CalculatorPublicationStatus,
  ) => {
    if (!isViewerGroupAdmin) {
      return;
    }

    templatesSyncVersionRef.current += 1;
    const currentTemplate = templatesRef.current.find((item) => item.id === template.id) ?? template;
    const now = new Date().toISOString();
    const nextTemplate = normalizeTemplateRecord({
      ...currentTemplate,
      publicationStatus,
      publishedAt:
        publicationStatus === 'published'
          ? currentTemplate.publishedAt ?? now
          : undefined,
      updatedAt: now,
      lastModifiedBy: currentAdminLabel,
    });

    const rollbackTemplates = templatesRef.current;
    const next = rollbackTemplates.some((item) => item.id === nextTemplate.id)
      ? rollbackTemplates.map((item) => {
          if (item.id === nextTemplate.id) {
            return nextTemplate;
          }

          if (publicationStatus === 'published' && item.publicationStatus === 'published') {
            return normalizeTemplateRecord({
              ...item,
              publicationStatus: 'draft',
              publishedAt: undefined,
              updatedAt: now,
              lastModifiedBy: currentAdminLabel,
            });
          }

          return item;
        })
      : [
          nextTemplate,
          ...rollbackTemplates.map((item) =>
            publicationStatus === 'published' && item.publicationStatus === 'published'
              ? normalizeTemplateRecord({
                  ...item,
                  publicationStatus: 'draft',
                  publishedAt: undefined,
                  updatedAt: now,
                  lastModifiedBy: currentAdminLabel,
                })
              : item,
          ),
        ];
    templatesRef.current = next;
    saveTemplates(next);
    setTemplates(next);

    if (selectedTemplateRef.current?.id === nextTemplate.id) {
      selectedTemplateRef.current = nextTemplate;
      setSelectedTemplate(nextTemplate);
    }

    try {
      const syncedTemplates = await syncTemplatesToServer(next);
      templatesRef.current = syncedTemplates;
      saveTemplates(syncedTemplates);
      setTemplates(syncedTemplates);
      setSelectedTemplate((current) =>
        current ? syncedTemplates.find((item) => item.id === current.id) ?? current : current,
      );
      setPaymentStatus({
        tone: 'success',
        message:
          publicationStatus === 'published'
            ? 'Калькулятор опубликован. Предыдущая публикация автоматически снята.'
            : 'Публикация снята. Сохранены изменения на сервере.',
      });
    } catch (error) {
      templatesRef.current = rollbackTemplates;
      saveTemplates(rollbackTemplates);
      setTemplates(rollbackTemplates);
      if (selectedTemplateRef.current?.id === nextTemplate.id) {
        selectedTemplateRef.current = currentTemplate;
        setSelectedTemplate(currentTemplate);
      }
      setPaymentStatus({
        tone: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Не удалось изменить статус публикации на сервере.',
      });
    }
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
      id: createRandomId(),
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
      fetch(createApiUrl('/api/communities?action=touch'), {
        method: 'POST',
        headers: createJsonHeaders(),
        body: JSON.stringify({
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

    fetch(createApiUrl('/api/communities?action=disconnect'), {
      method: 'POST',
      headers: createJsonHeaders(),
      body: JSON.stringify({
        groupId,
      }),
    })
      .then((response) => response.json().catch(() => null))
      .then((payload: { ok?: boolean; data?: CalculatorConnectedCommunity[] } | null) => {
        if (payload?.ok && Array.isArray(payload.data)) {
          setConnectedCommunities(
            scopeCommunitiesToContext(payload.data, currentGroupId, fallbackCommunity),
          );
        }
      })
      .catch(() => {
        // Keep the current communities list when disconnect sync fails.
      });
  };

  if (isStartupSplashVisible) {
    return <StartupSplash />;
  }

  return (
    <SplitLayout>
      <SplitCol width="100%" maxWidth="100%">
        <View activePanel={activeView}>
            <Panel id="home">
              {isViewerGroupAdmin && activeView === 'home' ? (
                <Suspense fallback={<AdminPageFallback title="Загружаем кабинет" />}>
                  <HomePage
                    connectedCommunities={connectedCommunities}
                    folders={folders}
                    activeFolderId={activeFolderId}
                    allTemplates={sortedTemplates}
                    templates={visibleTemplates}
                    isTemplatesLoading={isTemplatesLoading}
                    isCommunitiesLoading={isCommunitiesLoading}
                    adminSettings={adminSettings}
                    adminProfile={adminProfile}
                    vkAuthHeaders={vkAuthHeaders}
                    isAdminNavOpen={isAdminNavOpen}
                    currentSection={homeSection}
                    requests={requests}
                    analyticsEvents={analyticsEvents}
                    onSectionChange={setHomeSection}
                    onSaveAdminSettings={handleSaveAdminSettings}
                    onUpdateRequestStatus={handleUpdateRequestStatus}
                    onUpdateRequest={handleUpdateRequest}
                    onDeleteRequest={handleDeleteRequest}
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
                    onExportRequestsToGoogleSheets={handleExportRequestsToGoogleSheets}
                    requestLimit={requestLimit}
                    canUseTemplates={canUseTemplates}
                    canUseAnalytics={canUseAnalytics}
                    canUseNotifications={canUseNotifications}
                    canUseRequestStatuses={canUseRequestStatuses}
                    canUseFolders={canUseFolders}
                    onGrantProAccess={handleGrantProAccess}
                    onResetAllGroups={handleResetAllGroups}
                    onResetGroup={handleResetGroup}
                    isProcessingPayment={isProcessingPayment}
                    paymentStatus={paymentStatus}
                    canManageMonetization={isWebMonetizationPlatform}
                    isDesktopClient={isDesktopClient}
                    isCompactViewport={isCompactViewport}
                    isCommunityContext={currentGroupId > 0}
                  />
                </Suspense>
              ) : null}
            </Panel>
            <Panel id="builder">
              {activeView === 'builder' ? (
                <Suspense fallback={<BuilderPageFallback />}>
                  <BuilderPage
                    initialTemplate={selectedTemplate}
                    onBack={() => setActiveView('home')}
                    onSave={handleSaveTemplate}
                    canUseBooking={canUseBooking}
                    canUseProFeatures={canUseAdvancedFormulas}
                    isMonetizationRestricted={!isWebMonetizationPlatform}
                  />
                </Suspense>
              ) : null}
            </Panel>
            <Panel id="calculator">
              {activeView === 'calculator' && selectedTemplate ? (
                <Suspense fallback={<CalculatorPageFallback />}>
                  <CalculatorPage
                    template={selectedTemplate}
                    onOpenAdmin={isViewerGroupAdmin ? openAdminHome : undefined}
                    onInstallInCommunity={!isViewerGroupAdmin ? openCommunityInstall : undefined}
                    currentGroupId={currentGroupId}
                    canSubmitRequests={canCreateMoreRequests}
                    requestLimit={requestLimit}
                    requestsUsedThisMonth={monthlyRequestsUsed}
                    showBranding={!canHideBranding}
                    shouldTrackView={!isViewerGroupAdmin && currentGroupId > 0}
                    onRequestCreated={(request) =>
                      persistRequests([
                        request,
                        ...requests.filter((item) => item.id !== request.id),
                      ])
                    }
                  />
                </Suspense>
              ) : activeView === 'calculator' ? (
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
              ) : null}
            </Panel>
          </View>
      </SplitCol>
    </SplitLayout>
  );
};

export default App;


