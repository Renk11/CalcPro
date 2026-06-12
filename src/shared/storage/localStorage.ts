import type {
  CalculatorField,
  CalculatorAdminSettings,
  CalculatorFolder,
  CalculatorRequest,
  CalculatorSupportTicket,
  CalculatorTemplate,
} from '../types/calculator';
import { sanitizeHtml } from '../html/sanitizeHtml';
import {
  createDefaultRequestFormSettings,
  createEmptyTemplate,
  createTemplatePublicId,
  CURRENT_TEMPLATE_SCHEMA_VERSION,
} from '../../entities/calculator/model';
import { createDefaultSubscriptionSettings } from '../subscription';

const BASE_PREFIX = 'vk-community-calculator';
const DEMO_TEMPLATE_IDS = ['manicure', 'delivery', 'apartment-repair', 'printing'];
const SUPPORT_TICKET_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type StorageBucketKey =
  | 'templates'
  | 'folders'
  | 'requests'
  | 'support-tickets'
  | 'settings'
  | 'seeded';

let activeStorageGroupId = 0;

const isSupportTicketExpired = (ticket: CalculatorSupportTicket) => {
  const createdAt = Date.parse(ticket.createdAt || '');
  return !Number.isFinite(createdAt) || createdAt + SUPPORT_TICKET_RETENTION_MS <= Date.now();
};

const parseJson = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const normalizeStorageGroupId = (groupId?: number | string | null) => {
  const numericGroupId = Number(groupId);
  return Number.isInteger(numericGroupId) && numericGroupId > 0 ? numericGroupId : 0;
};

const buildStorageKey = (bucket: StorageBucketKey, groupId = activeStorageGroupId) =>
  groupId > 0 ? `${BASE_PREFIX}/${bucket}/group/${groupId}` : `${BASE_PREFIX}/${bucket}`;

const getLegacyStorageKey = (bucket: StorageBucketKey) => `${BASE_PREFIX}/${bucket}`;

const ensureScopedStorageInitialized = (groupId = activeStorageGroupId) => {
  const normalizedGroupId = normalizeStorageGroupId(groupId);
  const seededKey = buildStorageKey('seeded', normalizedGroupId);

  if (localStorage.getItem(seededKey)) {
    return;
  }

  const defaults = {
    templates: [] as CalculatorTemplate[],
    folders: [] as CalculatorFolder[],
    requests: [] as CalculatorRequest[],
    supportTickets: [] as CalculatorSupportTicket[],
    settings: {
      managerVkId: '',
      subscription: createDefaultSubscriptionSettings(),
    } satisfies CalculatorAdminSettings,
  };

  const templatesKey = buildStorageKey('templates', normalizedGroupId);
  const foldersKey = buildStorageKey('folders', normalizedGroupId);
  const requestsKey = buildStorageKey('requests', normalizedGroupId);
  const supportTicketsKey = buildStorageKey('support-tickets', normalizedGroupId);
  const settingsKey = buildStorageKey('settings', normalizedGroupId);

  if (normalizedGroupId > 0) {
    if (!localStorage.getItem(templatesKey)) {
      localStorage.setItem(
        templatesKey,
        localStorage.getItem(getLegacyStorageKey('templates')) ?? JSON.stringify(defaults.templates),
      );
    }

    if (!localStorage.getItem(foldersKey)) {
      localStorage.setItem(
        foldersKey,
        localStorage.getItem(getLegacyStorageKey('folders')) ?? JSON.stringify(defaults.folders),
      );
    }

    if (!localStorage.getItem(requestsKey)) {
      localStorage.setItem(
        requestsKey,
        localStorage.getItem(getLegacyStorageKey('requests')) ?? JSON.stringify(defaults.requests),
      );
    }

    if (!localStorage.getItem(supportTicketsKey)) {
      localStorage.setItem(
        supportTicketsKey,
        localStorage.getItem(getLegacyStorageKey('support-tickets')) ??
          JSON.stringify(defaults.supportTickets),
      );
    }

    if (!localStorage.getItem(settingsKey)) {
      localStorage.setItem(
        settingsKey,
        localStorage.getItem(getLegacyStorageKey('settings')) ?? JSON.stringify(defaults.settings),
      );
    }
  } else {
    if (!localStorage.getItem(templatesKey)) {
      localStorage.setItem(templatesKey, JSON.stringify(defaults.templates));
    }

    if (!localStorage.getItem(foldersKey)) {
      localStorage.setItem(foldersKey, JSON.stringify(defaults.folders));
    }

    if (!localStorage.getItem(requestsKey)) {
      localStorage.setItem(requestsKey, JSON.stringify(defaults.requests));
    }

    if (!localStorage.getItem(supportTicketsKey)) {
      localStorage.setItem(supportTicketsKey, JSON.stringify(defaults.supportTickets));
    }

    if (!localStorage.getItem(settingsKey)) {
      localStorage.setItem(settingsKey, JSON.stringify(defaults.settings));
    }
  }

  localStorage.setItem(seededKey, '1');
};

export const setStorageGroupScope = (groupId?: number | string | null) => {
  activeStorageGroupId = normalizeStorageGroupId(groupId);

  if (typeof window !== 'undefined') {
    ensureScopedStorageInitialized(activeStorageGroupId);
  }
};

export const getStorageGroupScope = () => activeStorageGroupId;

const getDefaultFieldPlaceholder = (field: Partial<CalculatorField>) => {
  if (
    field.type === 'number' ||
    field.type === 'slider' ||
    (field.type === 'input' && field.inputSubtype === 'number')
  ) {
    return 'Р’РІРµРґРёС‚Рµ С‡РёСЃР»Рѕ';
  }

  return 'Р’РІРµРґРёС‚Рµ С‚РµРєСЃС‚';
};

const getDefaultUseValueInFormula = (field: CalculatorField) =>
  field.type === 'number' ||
  field.type === 'slider' ||
  field.type === 'select' ||
  field.type === 'radio' ||
  field.type === 'checkbox' ||
  field.type === 'booking' ||
  (field.type === 'input' && field.inputSubtype === 'number');

const migrateFieldRecord = (field: CalculatorField): CalculatorField => {
  const normalizedField: CalculatorField = {
    ...field,
    layout: field.layout ?? 'full',
    marginTop: field.marginTop ?? 0,
    marginBottom: field.marginBottom ?? 0,
    marginLeft: field.marginLeft ?? 0,
    marginRight: field.marginRight ?? 0,
    required: field.required ?? false,
    unitPrice: Number(field.unitPrice) || 0,
    coefficient: Number(field.coefficient) || 1,
    description: field.description ?? '',
    hidden: field.hidden ?? false,
    visibilityCondition: field.visibilityCondition ?? '',
    placeholder: field.placeholder ?? getDefaultFieldPlaceholder(field),
    options: field.options ?? [],
    showOptionPrices: field.showOptionPrices ?? false,
    optionLayout: field.optionLayout ?? 'vertical',
    useValueInFormula: field.useValueInFormula ?? getDefaultUseValueInFormula(field),
    resultRounding: field.resultRounding ?? true,
    resultFormat: field.resultFormat ?? 'space',
    resultDisplayMode: field.resultDisplayMode ?? 'auto',
    showCurrentValue: field.showCurrentValue ?? false,
    showScale: field.showScale ?? false,
    hideScaleNumbers: field.hideScaleNumbers ?? false,
    allowManualInput: field.allowManualInput ?? false,
    showPriceInline: field.showPriceInline ?? false,
    showOptionDescription: field.showOptionDescription ?? field.showOptionDetails ?? false,
    showOptionPrice: field.showOptionPrice ?? field.showOptionDetails ?? false,
    buttonAction: field.buttonAction ?? (field.type === 'button' ? 'calculate' : undefined),
    buttonColor: field.buttonColor ?? 'accent',
    buttonSize: field.buttonSize ?? 'medium',
    buttonWidth: field.buttonWidth ?? 'auto',
    buttonRadius: field.buttonRadius ?? 18,
    buttonLoading: field.buttonLoading ?? false,
    buttonShowWhenValid: field.buttonShowWhenValid ?? false,
    imageSize: field.imageSize ?? 'large',
    imageRadius: field.imageRadius ?? 24,
    imageAlign: field.imageAlign ?? 'center',
    imageFit: field.imageFit ?? 'cover',
    bookingWeekdays: field.bookingWeekdays ?? [1, 2, 3, 4, 5],
    bookingStartTime: field.bookingStartTime ?? '09:00',
    bookingEndTime: field.bookingEndTime ?? '18:00',
    bookingCustomSlots: field.bookingCustomSlots ?? [],
    bookingSlotDuration: field.bookingSlotDuration ?? 60,
    bookingSlotBreak: field.bookingSlotBreak ?? 0,
    bookingExcludedDates: field.bookingExcludedDates ?? [],
    bookingMaxRequestsPerSlot: field.bookingMaxRequestsPerSlot ?? 1,
    bookingUrgentSurcharge: field.bookingUrgentSurcharge ?? 0,
    bookingUrgentThresholdHours: field.bookingUrgentThresholdHours ?? 24,
  };

  if (normalizedField.type === 'html') {
    normalizedField.htmlContent = sanitizeHtml(normalizedField.htmlContent ?? '');
  }

  return normalizedField;
};

const migrateTemplateRecord = (template: CalculatorTemplate): CalculatorTemplate => {
  const defaults = createEmptyTemplate(template.folderId);

  return {
    ...defaults,
    ...template,
    schemaVersion: CURRENT_TEMPLATE_SCHEMA_VERSION,
    requestForm: {
      ...createDefaultRequestFormSettings(),
      ...(template.requestForm ?? {}),
    },
    publicationStatus: template.publicationStatus ?? 'draft',
    publicId: template.publicId ?? createTemplatePublicId(template.id.slice(0, 8)),
    publishedAt:
      (template.publicationStatus ?? 'draft') === 'published'
        ? template.publishedAt ?? template.updatedAt ?? defaults.updatedAt
        : undefined,
    lastModifiedBy: template.lastModifiedBy ?? 'РђРґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂ',
    fields: (template.fields ?? []).map(migrateFieldRecord),
  };
};

const sanitizeTemplates = (templates: CalculatorTemplate[]) =>
  templates
    .filter((template) => !DEMO_TEMPLATE_IDS.includes(template.id))
    .map((template) => migrateTemplateRecord(template));

export const normalizeTemplateRecord = (template: CalculatorTemplate): CalculatorTemplate =>
  sanitizeTemplates([template])[0] ?? migrateTemplateRecord(template);

export const getTemplates = (): CalculatorTemplate[] => {
  ensureScopedStorageInitialized();
  const templates = parseJson<CalculatorTemplate[]>(
    localStorage.getItem(buildStorageKey('templates')),
    [],
  );
  const sanitizedTemplates = sanitizeTemplates(templates);

  if (JSON.stringify(sanitizedTemplates) !== JSON.stringify(templates)) {
    saveTemplates(sanitizedTemplates);
  }

  return sanitizedTemplates;
};

export const saveTemplates = (templates: CalculatorTemplate[]) => {
  localStorage.setItem(buildStorageKey('templates'), JSON.stringify(sanitizeTemplates(templates)));
};

export const upsertTemplate = (template: CalculatorTemplate) => {
  const templates = getTemplates();
  const normalizedTemplate = normalizeTemplateRecord(template);
  const next = templates.some((item) => item.id === normalizedTemplate.id)
    ? templates.map((item) => (item.id === normalizedTemplate.id ? normalizedTemplate : item))
    : [normalizedTemplate, ...templates];

  saveTemplates(next);
  return next;
};

export const getFolders = (): CalculatorFolder[] => {
  ensureScopedStorageInitialized();
  return parseJson<CalculatorFolder[]>(localStorage.getItem(buildStorageKey('folders')), []);
};

export const saveFolders = (folders: CalculatorFolder[]) => {
  localStorage.setItem(buildStorageKey('folders'), JSON.stringify(folders));
};

export const upsertFolder = (folder: CalculatorFolder) => {
  const folders = getFolders();
  const next = folders.some((item) => item.id === folder.id)
    ? folders.map((item) => (item.id === folder.id ? folder : item))
    : [...folders, folder];

  saveFolders(next);
  return next;
};

export const getRequests = (): CalculatorRequest[] => {
  ensureScopedStorageInitialized();
  return parseJson<CalculatorRequest[]>(localStorage.getItem(buildStorageKey('requests')), []);
};

export const addRequest = (request: CalculatorRequest) => {
  const requests = getRequests();
  const next = [request, ...requests];
  localStorage.setItem(buildStorageKey('requests'), JSON.stringify(next));
  return next;
};

export const getAdminSettings = (): CalculatorAdminSettings => {
  ensureScopedStorageInitialized();
  const settings = parseJson<Partial<CalculatorAdminSettings>>(
    localStorage.getItem(buildStorageKey('settings')),
    {},
  );
  const defaultSubscription = createDefaultSubscriptionSettings();

  return {
    managerVkId: settings.managerVkId ?? '',
    subscription: {
      ...defaultSubscription,
      ...(settings.subscription ?? {}),
      priceRub: Number(settings.subscription?.priceRub) || defaultSubscription.priceRub,
      plan: settings.subscription?.plan ?? defaultSubscription.plan,
      status: settings.subscription?.status ?? defaultSubscription.status,
      paidUntil: settings.subscription?.paidUntil ?? defaultSubscription.paidUntil,
      provider: settings.subscription?.provider ?? defaultSubscription.provider,
      externalPaymentId:
        settings.subscription?.externalPaymentId ?? defaultSubscription.externalPaymentId,
    },
  };
};

export const saveAdminSettings = (settings: CalculatorAdminSettings) => {
  localStorage.setItem(buildStorageKey('settings'), JSON.stringify(settings));
};

export const getSupportTickets = (): CalculatorSupportTicket[] => {
  ensureScopedStorageInitialized();
  const storageKey = buildStorageKey('support-tickets');
  const tickets = parseJson<CalculatorSupportTicket[]>(
    localStorage.getItem(storageKey),
    [],
  );
  const normalized = tickets
    .map((ticket) => ({
      ...ticket,
      status: ticket.status ?? 'pending',
      managerComment: ticket.managerComment ?? '',
    }))
    .filter((ticket) => !isSupportTicketExpired(ticket));

  if (normalized.length !== tickets.length) {
    localStorage.setItem(storageKey, JSON.stringify(normalized));
  }

  return normalized;
};

export const addSupportTicket = (ticket: CalculatorSupportTicket) => {
  const tickets = getSupportTickets();
  const next = [ticket, ...tickets];
  localStorage.setItem(buildStorageKey('support-tickets'), JSON.stringify(next));
  return next;
};

export const replaceSupportTickets = (tickets: CalculatorSupportTicket[]) => {
  localStorage.setItem(buildStorageKey('support-tickets'), JSON.stringify(tickets));
  return tickets;
};

export const updateSupportTicketStatus = (
  ticketId: string,
  status: CalculatorSupportTicket['status'],
) => {
  const tickets = getSupportTickets();
  const next = tickets.map((ticket) => (ticket.id === ticketId ? { ...ticket, status } : ticket));
  localStorage.setItem(buildStorageKey('support-tickets'), JSON.stringify(next));
  return next;
};

export const updateSupportTicketComment = (ticketId: string, managerComment: string) => {
  const tickets = getSupportTickets();
  const next = tickets.map((ticket) =>
    ticket.id === ticketId ? { ...ticket, managerComment } : ticket,
  );
  localStorage.setItem(buildStorageKey('support-tickets'), JSON.stringify(next));
  return next;
};
