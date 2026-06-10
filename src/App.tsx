import { useEffect, useMemo, useState } from 'react';
import bridge from '@vkontakte/vk-bridge';
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

type PaymentStatusTone = 'neutral' | 'success' | 'error';

type PaymentStatus = {
  tone: PaymentStatusTone;
  message: string;
};

const App = () => {
  const [activeView, setActiveView] = useState<AppView>('home');
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
  const hasActiveSubscription = useMemo(
    () => isSubscriptionActive(adminSettings.subscription),
    [adminSettings.subscription],
  );
  const canCreateMoreTemplates = hasActiveSubscription || templates.length < BASIC_TEMPLATE_LIMIT;

  useEffect(() => {
    bridge
      .send('VKWebAppGetUserInfo')
      .then((user) => {
        setAdminProfile({
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
    let isCancelled = false;

    const syncAdminSettings = async () => {
      try {
        const response = await fetch('/api/admin-settings');
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
  }, []);

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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const publicId = new URLSearchParams(window.location.search).get('calculator');
    if (!publicId) {
      return;
    }

    const publishedTemplate = templates.find(
      (template) => template.publicId === publicId && template.publicationStatus === 'published',
    );

    if (!publishedTemplate) {
      return;
    }

    setSelectedTemplate(publishedTemplate);
    setActiveView('calculator');
  }, [templates]);

  const openBuilder = (template?: CalculatorTemplate) => {
    setSelectedTemplate(template);
    setActiveView('builder');
  };

  const createTemplateInActiveFolder = () => {
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

  const handleSaveAdminSettings = (settings: CalculatorAdminSettings) => {
    persistAdminSettings(settings);

    fetch('/api/admin-settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(settings),
    }).catch(() => {
      // Local settings remain saved even if the API request fails.
    });
  };

  const persistAdminSettings = (settings: CalculatorAdminSettings) => {
    saveAdminSettings(settings);
    setAdminSettings(settings);
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

      window.location.href = payload.data.payment.confirmationUrl;
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
    const normalizedTemplate = normalizeTemplateRecord({
      ...template,
      title: clampTemplateTitle(template.title),
      description: clampTemplateDescription(template.description),
      lastModifiedBy: currentAdminLabel,
    });
    const next = upsertTemplate(normalizedTemplate);
    setTemplates(next);
    setSelectedTemplate(normalizedTemplate);
  };

  const duplicateTemplate = (template: CalculatorTemplate) => {
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
    setTemplates(next);
  };

  const deleteTemplate = (template: CalculatorTemplate) => {
    const next = templates.filter((item) => item.id !== template.id);
    saveTemplates(next);
    setTemplates(next);

    if (selectedTemplate?.id === template.id) {
      setSelectedTemplate(undefined);
    }
  };

  const updateTemplatePublicationStatus = (
    template: CalculatorTemplate,
    publicationStatus: CalculatorPublicationStatus,
  ) => {
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
    setTemplates(next);

    if (selectedTemplate?.id === template.id) {
      setSelectedTemplate(nextTemplate);
    }
  };

  const handleCopyTemplateLink = async (template: CalculatorTemplate) => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(getPublicCalculatorUrl(template.publicId));
  };

  const moveTemplateToFolder = (template: CalculatorTemplate, folderId?: string) => {
    const moved: CalculatorTemplate = {
      ...template,
      folderId,
      updatedAt: new Date().toISOString(),
    };

    const next = upsertTemplate(moved);
    setTemplates(next);

    if (selectedTemplate?.id === template.id) {
      setSelectedTemplate(moved);
    }
  };

  const createFolder = () => {
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
    const nextFolders = folders.filter((folder) => folder.id !== folderId);
    const nextTemplates = templates.map((template) =>
      template.folderId === folderId ? { ...template, folderId: undefined } : template,
    );

    saveFolders(nextFolders);
    saveTemplates(nextTemplates);
    setFolders(nextFolders);
    setTemplates(nextTemplates);

    if (activeFolderId === folderId) {
      setActiveFolderId('all');
    }
  };

  return (
    <SplitLayout>
      <SplitCol width="100%" maxWidth="100%">
        <View activePanel={activeView}>
          <Panel id="home">
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
              canCreateMoreTemplates={canCreateMoreTemplates}
              templateLimit={BASIC_TEMPLATE_LIMIT}
              onStartPayment={startSubscriptionPayment}
              isProcessingPayment={isProcessingPayment}
              paymentStatus={paymentStatus}
            />
          </Panel>
          <Panel id="builder">
            <BuilderPage
              initialTemplate={selectedTemplate}
              onBack={() => setActiveView('home')}
              onSave={handleSaveTemplate}
              canUseBooking={hasActiveSubscription}
            />
          </Panel>
          <Panel id="calculator">
            {selectedTemplate ? (
              <CalculatorPage
                template={selectedTemplate}
                onBack={() => {
                  if (typeof window !== 'undefined') {
                    const url = new URL(window.location.href);
                    url.searchParams.delete('calculator');
                    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
                  }
                  setActiveView('home');
                }}
                onRequestCreated={(request) =>
                  setRequests((current) => [request, ...current.filter((item) => item.id !== request.id)])
                }
              />
            ) : null}
          </Panel>
        </View>
      </SplitCol>
    </SplitLayout>
  );
};

export default App;
