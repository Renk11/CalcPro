import type {
  CalculatorAdminSettings,
  CalculatorFolder,
  CalculatorRequest,
  CalculatorTemplate,
} from '../types/calculator';
import { sanitizeHtml } from '../html/sanitizeHtml';

const TEMPLATES_KEY = 'vk-community-calculator/templates';
const FOLDERS_KEY = 'vk-community-calculator/folders';
const REQUESTS_KEY = 'vk-community-calculator/requests';
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
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ managerVkId: '' }));
  localStorage.setItem(SEEDED_KEY, '1');
};

const sanitizeTemplates = (templates: CalculatorTemplate[]) => {
  return templates
    .filter((template) => !DEMO_TEMPLATE_IDS.includes(template.id))
    .map((template) => ({
      ...template,
      fields: template.fields.map((field) =>
        field.type === 'html'
          ? {
              ...field,
              htmlContent: sanitizeHtml(field.htmlContent ?? ''),
            }
          : field,
      ),
    }));
};

export const getTemplates = (): CalculatorTemplate[] => {
  ensureSeeded();
  const templates = parseJson<CalculatorTemplate[]>(localStorage.getItem(TEMPLATES_KEY), []);
  const sanitizedTemplates = sanitizeTemplates(templates);

  if (sanitizedTemplates.length !== templates.length) {
    saveTemplates(sanitizedTemplates);
  }

  return sanitizedTemplates;
};

export const saveTemplates = (templates: CalculatorTemplate[]) => {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
};

export const upsertTemplate = (template: CalculatorTemplate) => {
  const templates = getTemplates();
  const next = templates.some((item) => item.id === template.id)
    ? templates.map((item) => (item.id === template.id ? template : item))
    : [template, ...templates];

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

  return {
    managerVkId: settings.managerVkId ?? '',
  };
};

export const saveAdminSettings = (settings: CalculatorAdminSettings) => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
};
