import { supabaseSelect, supabaseUpsert } from './supabase.js';
import { getServerAdminSettings } from './settings-store.js';
import { getEffectiveSubscriptionPlan, getSubscriptionPlanConfig } from './subscription-config.js';

const TEMPLATES_KEY = 'calcpro:templates';
const GROUP_TEMPLATES_KEY_PREFIX = 'calcpro:templates:group:';

function normalizeGroupId(groupId) {
  const numericGroupId = Number(groupId);
  return Number.isInteger(numericGroupId) && numericGroupId > 0 ? String(numericGroupId) : '';
}

function getTemplatesKey(groupId) {
  const normalizedGroupId = normalizeGroupId(groupId);
  return normalizedGroupId ? `${GROUP_TEMPLATES_KEY_PREFIX}${normalizedGroupId}` : TEMPLATES_KEY;
}

function normalizeTemplates(templates = []) {
  return Array.isArray(templates)
    ? templates.filter((template) => template && typeof template === 'object')
    : [];
}

function restrictTemplateByPlan(template, planConfig) {
  const nextTemplate = {
    ...template,
    fields: Array.isArray(template.fields) ? template.fields : [],
  };

  if (!planConfig.features.folders) {
    nextTemplate.folderId = undefined;
  }

  if (!planConfig.features.advancedFormulas) {
    nextTemplate.formulaMode = 'simple';
    nextTemplate.customFormula = '';
    nextTemplate.visualFormulaTokens = [];
  }

  if (!planConfig.features.booking) {
    nextTemplate.fields = nextTemplate.fields.filter((field) => field?.type !== 'booking');
  }

  delete nextTemplate.hideBranding;

  return nextTemplate;
}

function normalizeTemplatesForPlan(templates, planConfig) {
  const normalizedTemplates = normalizeTemplates(templates).map((template) =>
    restrictTemplateByPlan(template, planConfig),
  );
  const limitedTemplates =
    planConfig.calculatorLimit == null
      ? normalizedTemplates
      : normalizedTemplates.slice(0, Math.max(0, planConfig.calculatorLimit));

  let hasPublishedTemplate = false;
  return limitedTemplates.map((template) => {
    if (template.publicationStatus !== 'published') {
      return template;
    }

    if (!hasPublishedTemplate) {
      hasPublishedTemplate = true;
      return template;
    }

    return {
      ...template,
      publicationStatus: 'draft',
      publishedAt: undefined,
    };
  });
}

function findPublishedTemplateInCollection(templates, publicId) {
  const normalizedPublicId = String(publicId || '').trim();
  if (!normalizedPublicId) {
    return null;
  }

  return (
    normalizeTemplates(templates).find(
      (template) =>
        String(template?.publicId || '').trim() === normalizedPublicId &&
        String(template?.publicationStatus || '').trim() === 'published',
    ) || null
  );
}

function createTemplateId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `template-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createTemplatePublicId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function readSettingRow(key) {
  try {
    const rows = await supabaseSelect('app_settings', {
      select: 'value',
      filter: { key: 'key', value: `eq.${key}` },
      limit: 1,
    });

    return rows?.[0]?.value ?? null;
  } catch (error) {
    if (String(error?.message || '').includes('schema cache')) {
      return null;
    }

    throw error;
  }
}

async function writeSettingRow(key, value) {
  try {
    await supabaseUpsert(
      'app_settings',
      [
        {
          key,
          value,
        },
      ],
      { onConflict: 'key' },
    );
  } catch (error) {
    if (!String(error?.message || '').includes('schema cache')) {
      throw error;
    }
  }
}

export async function getServerTemplates(groupId) {
  const scopedKey = getTemplatesKey(groupId);
  const scopedTemplates = await readSettingRow(scopedKey);

  if (scopedTemplates) {
    return normalizeTemplates(scopedTemplates);
  }

  if (normalizeGroupId(groupId)) {
    return normalizeTemplates([]);
  }

  return normalizeTemplates([]);
}

export async function findPublishedTemplateByPublicId(publicId) {
  const normalizedPublicId = String(publicId || '').trim();
  if (!normalizedPublicId) {
    return null;
  }

  const scopedRows = await supabaseSelect('app_settings', {
    select: 'key,value',
    filter: { key: 'key', value: `like.${GROUP_TEMPLATES_KEY_PREFIX}%` },
    limit: 1000,
  });

  for (const row of scopedRows || []) {
    const matchedTemplate = findPublishedTemplateInCollection(row?.value, normalizedPublicId);
    if (matchedTemplate) {
      return matchedTemplate;
    }
  }

  const legacyTemplates = await readSettingRow(TEMPLATES_KEY);
  return findPublishedTemplateInCollection(legacyTemplates, normalizedPublicId);
}

function withStableTemplateIds(templates, existingTemplates) {
  const existingByPublicId = new Map(
    existingTemplates
      .filter((template) => template?.publicId)
      .map((template) => [String(template.publicId), template]),
  );

  return normalizeTemplates(templates).map((template) => {
    const existing = template?.publicId ? existingByPublicId.get(String(template.publicId)) : undefined;
    return existing ? { ...template, id: existing.id, createdAt: existing.createdAt } : template;
  });
}

export async function saveServerTemplates(templates, groupId) {
  const settings = await getServerAdminSettings(groupId);
  const planConfig = getEffectiveSubscriptionPlan(settings.subscription);
  const existingTemplates = await getServerTemplates(groupId);
  const stableTemplates = withStableTemplateIds(templates, existingTemplates);
  const normalized = normalizeTemplatesForPlan(stableTemplates, planConfig);
  await writeSettingRow(getTemplatesKey(groupId), normalized);
  return normalized;
}

export async function transferServerTemplate(templateId, fromGroupId, toGroupId) {
  const normalizedTemplateId = String(templateId || '').trim();
  const sourceGroupId = Number(fromGroupId) || 0;
  const targetGroupId = Number(toGroupId) || 0;

  if (!normalizedTemplateId) {
    throw new Error('templateId is required');
  }

  if (sourceGroupId <= 0 || targetGroupId <= 0) {
    throw new Error('Both fromGroupId and toGroupId are required');
  }

  if (sourceGroupId === targetGroupId) {
    throw new Error('Target community must differ from the current one');
  }

  const sourceTemplates = await getServerTemplates(sourceGroupId);
  const targetTemplates = await getServerTemplates(targetGroupId);
  const sourceTemplate = sourceTemplates.find((template) => String(template.id) === normalizedTemplateId);

  if (!sourceTemplate) {
    throw new Error('Template not found in the source community');
  }

  const targetSettings = await getServerAdminSettings(targetGroupId);
  const targetPlan = getSubscriptionPlanConfig(targetSettings.subscription.plan);
  const targetLimit = targetPlan.calculatorLimit;

  if (targetLimit != null && targetTemplates.length >= targetLimit) {
    throw new Error(`Лимит калькуляторов в сообществе назначения: ${targetLimit}`);
  }

  const now = new Date().toISOString();
  const movedTemplate = {
    ...sourceTemplate,
    id: createTemplateId(),
    publicId: createTemplatePublicId(),
    groupId: targetGroupId,
    folderId: undefined,
    publicationStatus: 'draft',
    publishedAt: '',
    updatedAt: now,
    lastModifiedBy: sourceTemplate.lastModifiedBy || 'Администратор',
  };

  const nextSourceTemplates = sourceTemplates.filter(
    (template) => String(template.id) !== normalizedTemplateId,
  );
  const nextTargetTemplates = [movedTemplate, ...targetTemplates];

  await saveServerTemplates(nextSourceTemplates, sourceGroupId);
  await saveServerTemplates(nextTargetTemplates, targetGroupId);

  return {
    movedTemplate,
    sourceTemplates: nextSourceTemplates,
    targetTemplates: nextTargetTemplates,
  };
}
