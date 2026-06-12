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

const TEMPLATES_KEY = 'vk-community-calculator/templates';
const FOLDERS_KEY = 'vk-community-calculator/folders';
const REQUESTS_KEY = 'vk-community-calculator/requests';
const SUPPORT_TICKETS_KEY = 'vk-community-calculator/support-tickets';
const SETTINGS_KEY = 'vk-community-calculator/settings';
const SEEDED_KEY = 'vk-community-calculator/seeded';
const DEMO_TEMPLATE_IDS = ['manicure', 'delivery', 'apartment-repair', 'printing'];

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

const ensureSeeded = () => {
  if (localStorage.getItem(SEEDED_KEY)) {
    return;
  }

  localStorage.setItem(TEMPLATES_KEY, JSON.stringify([]));
  localStorage.setItem(FOLDERS_KEY, JSON.stringify([]));
  localStorage.setItem(REQUESTS_KEY, JSON.stringify([]));
  localStorage.setItem(SUPPORT_TICKETS_KEY, JSON.stringify([]));
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      managerVkId: '',
      subscription: createDefaultSubscriptionSettings(),
    }),
  );
  localStorage.setItem(SEEDED_KEY, '1');
};

const getDefaultFieldPlaceholder = (field: Partial<CalculatorField>) => {
  if (
    field.type === 'number' ||
    field.type === 'slider' ||
    (field.type === 'input' && field.inputSubtype === 'number')
  ) {
    return 'Введите число';
  }

  return 'Введите текст';
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
    lastModifiedBy: template.lastModifiedBy ?? 'Администратор',
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
  ensureSeeded();
  const templates = parseJson<CalculatorTemplate[]>(localStorage.getItem(TEMPLATES_KEY), []);
  const sanitizedTemplates = sanitizeTemplates(templates);

  if (JSON.stringify(sanitizedTemplates) !== JSON.stringify(templates)) {
    saveTemplates(sanitizedTemplates);
  }

  return sanitizedTemplates;
};

export const saveTemplates = (templates: CalculatorTemplate[]) => {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(sanitizeTemplates(templates)));
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
  ensureSeeded();
  return parseJson<CalculatorFolder[]>(localStorage.getItem(FOLDERS_KEY), []);
};

export const saveFolders = (folders: CalculatorFolder[]) => {
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
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
  ensureSeeded();
  return parseJson<CalculatorRequest[]>(localStorage.getItem(REQUESTS_KEY), []);
};

export const addRequest = (request: CalculatorRequest) => {
  const requests = getRequests();
  const next = [request, ...requests];
  localStorage.setItem(REQUESTS_KEY, JSON.stringify(next));
  return next;
};

export const getAdminSettings = (): CalculatorAdminSettings => {
  ensureSeeded();
  const settings = parseJson<Partial<CalculatorAdminSettings>>(localStorage.getItem(SETTINGS_KEY), {});
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
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
};

export const getSupportTickets = (): CalculatorSupportTicket[] => {
  ensureSeeded();
  return parseJson<CalculatorSupportTicket[]>(localStorage.getItem(SUPPORT_TICKETS_KEY), []);
};

export const addSupportTicket = (ticket: CalculatorSupportTicket) => {
  const tickets = getSupportTickets();
  const next = [ticket, ...tickets];
  localStorage.setItem(SUPPORT_TICKETS_KEY, JSON.stringify(next));
  return next;
};
