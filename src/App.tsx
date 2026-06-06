import { useEffect, useMemo, useState } from 'react';
import bridge from '@vkontakte/vk-bridge';
import { Panel, SplitCol, SplitLayout, View } from '@vkontakte/vkui';
import {
  clampFolderName,
  clampTemplateDescription,
  clampTemplateTitle,
  createEmptyTemplate,
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
  saveAdminSettings,
  saveFolders,
  saveTemplates,
  upsertFolder,
  upsertTemplate,
} from './shared/storage/localStorage';
import type {
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

  const openBuilder = (template?: CalculatorTemplate) => {
    setSelectedTemplate(template);
    setActiveView('builder');
  };

  const createTemplateInActiveFolder = () => {
    const nextTemplate = createEmptyTemplate(activeFolderId === 'all' ? undefined : activeFolderId);
    setSelectedTemplate(nextTemplate);
    setActiveView('builder');
  };

  const createTemplateFromCatalog = (presetId: string) => {
    const nextTemplate = createTemplateFromPreset(
      presetId,
      activeFolderId === 'all' ? undefined : activeFolderId,
    );

    if (!nextTemplate) {
      return;
    }

    setHomeSection('templates');
    setSelectedTemplate(nextTemplate);
    setActiveView('builder');
  };

  const openCalculator = (template: CalculatorTemplate) => {
    setSelectedTemplate(template);
    setActiveView('calculator');
  };

  const handleSaveAdminSettings = (settings: CalculatorAdminSettings) => {
    saveAdminSettings(settings);
    setAdminSettings(settings);
  };

  const handleSaveTemplate = (template: CalculatorTemplate) => {
    const normalizedTemplate = {
      ...template,
      title: clampTemplateTitle(template.title),
      description: clampTemplateDescription(template.description),
    };
    const next = upsertTemplate(normalizedTemplate);
    setTemplates(next);
    setSelectedTemplate(normalizedTemplate);
  };

  const duplicateTemplate = (template: CalculatorTemplate) => {
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
            />
          </Panel>
          <Panel id="builder">
            <BuilderPage
              initialTemplate={selectedTemplate}
              onBack={() => setActiveView('home')}
              onSave={handleSaveTemplate}
            />
          </Panel>
          <Panel id="calculator">
            {selectedTemplate ? (
              <CalculatorPage
                template={selectedTemplate}
                onBack={() => setActiveView('home')}
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
