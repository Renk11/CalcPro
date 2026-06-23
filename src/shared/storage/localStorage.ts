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
import { createDefaultSubscriptionSettings, getSubscriptionPlanConfig } from '../subscription';
import { getStorageItem, setStorageItem } from './safeStorage';

const BASE_PREFIX = 'vk-community-calculator';
const DEMO_TEMPLATE_IDS = ['manicure', 'delivery', 'apartment-repair', 'printing'];
const SUPPORT_TICKET_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MOJIBAKE_PATTERN = /(?:Р.|С.){2,}|[\uFFFD]/u;

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

const hasMojibake = (value?: string) => Boolean(value && MOJIBAKE_PATTERN.test(value));
const getDefaultFolderName = () => 'Новая папка';

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

  if (getStorageItem(seededKey)) {
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
    if (!getStorageItem(templatesKey)) {
      setStorageItem(
        templatesKey,
        getStorageItem(getLegacyStorageKey('templates')) ?? JSON.stringify(defaults.templates),
      );
    }

    if (!getStorageItem(foldersKey)) {
      setStorageItem(
        foldersKey,
        getStorageItem(getLegacyStorageKey('folders')) ?? JSON.stringify(defaults.folders),
      );
    }

    if (!getStorageItem(requestsKey)) {
      setStorageItem(
        requestsKey,
        JSON.stringify(defaults.requests),
      );
    }

    if (!getStorageItem(supportTicketsKey)) {
      setStorageItem(
        supportTicketsKey,
        getStorageItem(getLegacyStorageKey('support-tickets')) ??
          JSON.stringify(defaults.supportTickets),
      );
    }

    if (!getStorageItem(settingsKey)) {
      setStorageItem(
        settingsKey,
        getStorageItem(getLegacyStorageKey('settings')) ?? JSON.stringify(defaults.settings),
      );
    }
  } else {
    if (!getStorageItem(templatesKey)) {
      setStorageItem(templatesKey, JSON.stringify(defaults.templates));
    }

    if (!getStorageItem(foldersKey)) {
      setStorageItem(foldersKey, JSON.stringify(defaults.folders));
    }

    if (!getStorageItem(requestsKey)) {
      setStorageItem(requestsKey, JSON.stringify(defaults.requests));
    }

    if (!getStorageItem(supportTicketsKey)) {
      setStorageItem(supportTicketsKey, JSON.stringify(defaults.supportTickets));
    }

    if (!getStorageItem(settingsKey)) {
      setStorageItem(settingsKey, JSON.stringify(defaults.settings));
    }
  }

  setStorageItem(seededKey, '1');
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
  const requestFormDefaults = createDefaultRequestFormSettings();
  const requestForm = {
    ...requestFormDefaults,
    ...(template.requestForm ?? {}),
  };

  return {
    ...defaults,
    ...template,
    title: hasMojibake(template.title) ? defaults.title : template.title,
    description: hasMojibake(template.description) ? defaults.description : template.description,
    schemaVersion: CURRENT_TEMPLATE_SCHEMA_VERSION,
    requestForm: {
      ...requestForm,
      title: hasMojibake(requestForm.title) ? requestFormDefaults.title : requestForm.title,
      description: hasMojibake(requestForm.description)
        ? requestFormDefaults.description
        : requestForm.description,
      nameLabel: hasMojibake(requestForm.nameLabel)
        ? requestFormDefaults.nameLabel
        : requestForm.nameLabel,
      namePlaceholder: hasMojibake(requestForm.namePlaceholder)
        ? requestFormDefaults.namePlaceholder
        : requestForm.namePlaceholder,
      phoneLabel: hasMojibake(requestForm.phoneLabel)
        ? requestFormDefaults.phoneLabel
        : requestForm.phoneLabel,
      phonePlaceholder: hasMojibake(requestForm.phonePlaceholder)
        ? requestFormDefaults.phonePlaceholder
        : requestForm.phonePlaceholder,
      commentLabel: hasMojibake(requestForm.commentLabel)
        ? requestFormDefaults.commentLabel
        : requestForm.commentLabel,
      commentPlaceholder: hasMojibake(requestForm.commentPlaceholder)
        ? requestFormDefaults.commentPlaceholder
        : requestForm.commentPlaceholder,
      submitButtonText: hasMojibake(requestForm.submitButtonText)
        ? requestFormDefaults.submitButtonText
        : requestForm.submitButtonText,
    },
    publicationStatus: template.publicationStatus ?? 'draft',
    publicId: template.publicId ?? createTemplatePublicId(template.id.slice(0, 8)),
    publishedAt:
      (template.publicationStatus ?? 'draft') === 'published'
        ? template.publishedAt ?? template.updatedAt ?? defaults.updatedAt
        : undefined,
    lastModifiedBy:
      !template.lastModifiedBy || hasMojibake(template.lastModifiedBy)
        ? 'Администратор'
        : template.lastModifiedBy,
    fields: (template.fields ?? []).map(migrateFieldRecord),
  };
};

const sanitizeTemplates = (templates: CalculatorTemplate[]) =>
  templates
    .filter((template) => !DEMO_TEMPLATE_IDS.includes(template.id))
    .map((template) => migrateTemplateRecord(template));

const sanitizeFolders = (folders: CalculatorFolder[]) =>
  folders.map((folder) => ({
    ...folder,
    name: hasMojibake(folder.name) ? getDefaultFolderName() : folder.name,
  }));

const sanitizeRequests = (requests: CalculatorRequest[]) =>
  requests.map((request) => ({
    ...request,
    status:
      request.status === 'in_progress' ||
      request.status === 'done' ||
      request.status === 'rejected' ||
      request.status === 'new'
        ? request.status
        : 'new',
  }));

export const normalizeTemplateRecord = (template: CalculatorTemplate): CalculatorTemplate =>
  sanitizeTemplates([template])[0] ?? migrateTemplateRecord(template);

export const getTemplates = (): CalculatorTemplate[] => {
  ensureScopedStorageInitialized();
  const templates = parseJson<CalculatorTemplate[]>(
    getStorageItem(buildStorageKey('templates')),
    [],
  );
  const sanitizedTemplates = sanitizeTemplates(templates);

  if (JSON.stringify(sanitizedTemplates) !== JSON.stringify(templates)) {
    saveTemplates(sanitizedTemplates);
  }

  return sanitizedTemplates;
};

export const saveTemplates = (templates: CalculatorTemplate[]) => {
  setStorageItem(buildStorageKey('templates'), JSON.stringify(sanitizeTemplates(templates)));
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
  const folders = parseJson<CalculatorFolder[]>(getStorageItem(buildStorageKey('folders')), []);
  const sanitizedFolders = sanitizeFolders(folders);

  if (JSON.stringify(sanitizedFolders) !== JSON.stringify(folders)) {
    saveFolders(sanitizedFolders);
  }

  return sanitizedFolders;
};

export const saveFolders = (folders: CalculatorFolder[]) => {
  setStorageItem(buildStorageKey('folders'), JSON.stringify(sanitizeFolders(folders)));
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
  const requests = parseJson<CalculatorRequest[]>(getStorageItem(buildStorageKey('requests')), []);
  const sanitizedRequests = sanitizeRequests(requests);

  if (JSON.stringify(sanitizedRequests) !== JSON.stringify(requests)) {
    saveRequests(sanitizedRequests);
  }

  return sanitizedRequests;
};

export const addRequest = (request: CalculatorRequest) => {
  const requests = getRequests();
  const next = sanitizeRequests([request, ...requests]);
  setStorageItem(buildStorageKey('requests'), JSON.stringify(next));
  return next;
};

export const saveRequests = (requests: CalculatorRequest[]) => {
  setStorageItem(buildStorageKey('requests'), JSON.stringify(sanitizeRequests(requests)));
};

export const updateRequestStatus = (
  requestId: string,
  status: CalculatorRequest['status'],
) => {
  const requests = getRequests();
  const next = requests.map((request) =>
    request.id === requestId ? { ...request, status } : request,
  );
  saveRequests(next);
  return next;
};

export const deleteRequest = (requestId: string) => {
  const requests = getRequests();
  const next = requests.filter((request) => request.id !== requestId);
  saveRequests(next);
  return next;
};

export const getAdminSettings = (): CalculatorAdminSettings => {
  ensureScopedStorageInitialized();
  const settings = parseJson<Partial<CalculatorAdminSettings>>(
    getStorageItem(buildStorageKey('settings')),
    {},
  );
  const defaultSubscription = createDefaultSubscriptionSettings();

  return {
    managerVkId: settings.managerVkId ?? '',
    subscription: {
      ...defaultSubscription,
      ...(settings.subscription ?? {}),
      priceRub:
        Number(settings.subscription?.priceRub) ||
        getSubscriptionPlanConfig(settings.subscription?.plan ?? defaultSubscription.plan).monthlyPriceRub,
      plan: getSubscriptionPlanConfig(settings.subscription?.plan ?? defaultSubscription.plan).id,
      status: settings.subscription?.status ?? defaultSubscription.status,
      paidUntil: settings.subscription?.paidUntil ?? defaultSubscription.paidUntil,
      provider: settings.subscription?.provider ?? defaultSubscription.provider,
      externalPaymentId:
        settings.subscription?.externalPaymentId ?? defaultSubscription.externalPaymentId,
    },
  };
};

export const saveAdminSettings = (settings: CalculatorAdminSettings) => {
  setStorageItem(buildStorageKey('settings'), JSON.stringify(settings));
};

export const getSupportTickets = (): CalculatorSupportTicket[] => {
  ensureScopedStorageInitialized();
  const storageKey = buildStorageKey('support-tickets');
  const tickets = parseJson<CalculatorSupportTicket[]>(
    getStorageItem(storageKey),
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
    setStorageItem(storageKey, JSON.stringify(normalized));
  }

  return normalized;
};

export const addSupportTicket = (ticket: CalculatorSupportTicket) => {
  const tickets = getSupportTickets();
  const next = [ticket, ...tickets];
  setStorageItem(buildStorageKey('support-tickets'), JSON.stringify(next));
  return next;
};

export const replaceSupportTickets = (tickets: CalculatorSupportTicket[]) => {
  setStorageItem(buildStorageKey('support-tickets'), JSON.stringify(tickets));
  return tickets;
};

export const updateSupportTicketStatus = (
  ticketId: string,
  status: CalculatorSupportTicket['status'],
) => {
  const tickets = getSupportTickets();
  const next = tickets.map((ticket) => (ticket.id === ticketId ? { ...ticket, status } : ticket));
  setStorageItem(buildStorageKey('support-tickets'), JSON.stringify(next));
  return next;
};

export const updateSupportTicketComment = (ticketId: string, managerComment: string) => {
  const tickets = getSupportTickets();
  const next = tickets.map((ticket) =>
    ticket.id === ticketId ? { ...ticket, managerComment } : ticket,
  );
  setStorageItem(buildStorageKey('support-tickets'), JSON.stringify(next));
  return next;
};
