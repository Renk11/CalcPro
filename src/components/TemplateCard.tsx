import { useEffect, useRef, useState } from 'react';
import type {
  CalculatorFolder,
  CalculatorPublicationStatus,
  CalculatorTemplate,
} from '../shared/types/calculator';

interface TemplateCardProps {
  template: CalculatorTemplate;
  folders: CalculatorFolder[];
  canDuplicate: boolean;
  canUseFolders: boolean;
  onOpen: (template: CalculatorTemplate) => void;
  onEdit: (template: CalculatorTemplate) => void;
  onDuplicate: (template: CalculatorTemplate) => void;
  onDelete: (template: CalculatorTemplate) => void;
  onMoveToFolder: (template: CalculatorTemplate, folderId?: string) => void;
  onUpdateStatus: (
    template: CalculatorTemplate,
    publicationStatus: CalculatorPublicationStatus,
  ) => void;
}

const publicationStatusLabels: Record<CalculatorPublicationStatus, string> = {
  draft: 'Черновик',
  published: 'Опубликован',
  hidden: 'Скрыт',
  archived: 'Архив',
};

const hasMojibake = (value?: string) =>
  typeof value === 'string' &&
  (value.includes('Р В ') ||
    value.includes('Р“С’') ||
    value.includes('Р“вЂ') ||
    value.includes('Р Р†Р вЂљ') ||
    value.includes('Р“вЂљ'));

const formatTemplateDate = (value?: string) =>
  value
    ? new Date(value).toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : 'Не опубликован';

export const TemplateCard = ({
  template,
  folders,
  canDuplicate,
  canUseFolders,
  onOpen,
  onEdit,
  onDuplicate,
  onDelete,
  onMoveToFolder,
  onUpdateStatus,
}: TemplateCardProps) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const isPublished = template.publicationStatus === 'published';
  const isDraft = template.publicationStatus === 'draft';
  const isHidden = template.publicationStatus === 'hidden';
  const isArchived = template.publicationStatus === 'archived';
  const safeTitle = hasMojibake(template.title) ? 'Новый калькулятор' : template.title;
  const safeDescription = hasMojibake(template.description) ? '' : template.description;
  const safeLastModifiedBy = hasMojibake(template.lastModifiedBy)
    ? 'Администратор'
    : template.lastModifiedBy;

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsMenuOpen(false);
        setIsFolderPickerOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isMenuOpen]);

  return (
    <article className={`template-card ${isMenuOpen ? 'template-card_menu-open' : ''}`}>
      <div className="template-card__content">
        <div className="template-card__header">
          <div className="template-card__head-row">
            <div className="template-card__head-copy">
              <div
                className={`template-card__status template-card__status_${template.publicationStatus}`}
              >
                {publicationStatusLabels[template.publicationStatus]}
              </div>
              <h3 className="template-card__title">{safeTitle}</h3>
            </div>

            <div className="template-card__menu" ref={menuRef}>
              <button
                className="template-card__menu-trigger"
                type="button"
                aria-label="Действия с калькулятором"
                onClick={() => {
                  setIsMenuOpen((current) => !current);
                  setIsFolderPickerOpen(false);
                }}
              >
                ...
              </button>

              {isMenuOpen ? (
                <div className="template-card__menu-popover">
                  <button
                    className="template-card__menu-action"
                    type="button"
                    disabled={isPublished}
                    onClick={() => {
                      onUpdateStatus(template, 'published');
                      setIsMenuOpen(false);
                    }}
                  >
                    Опубликовать
                  </button>
                  <button
                    className="template-card__menu-action"
                    type="button"
                    disabled={isDraft}
                    onClick={() => {
                      onUpdateStatus(template, 'draft');
                      setIsMenuOpen(false);
                    }}
                  >
                    В черновик
                  </button>
                  <button
                    className="template-card__menu-action"
                    type="button"
                    disabled={isHidden}
                    onClick={() => {
                      onUpdateStatus(template, 'hidden');
                      setIsMenuOpen(false);
                    }}
                  >
                    Скрыть
                  </button>
                  <button
                    className="template-card__menu-action"
                    type="button"
                    disabled={isArchived}
                    onClick={() => {
                      onUpdateStatus(template, 'archived');
                      setIsMenuOpen(false);
                    }}
                  >
                    В архив
                  </button>
                  <button
                    className="template-card__menu-action"
                    type="button"
                    disabled={!canDuplicate}
                    onClick={() => {
                      onDuplicate(template);
                      setIsMenuOpen(false);
                    }}
                  >
                    {canDuplicate ? 'Дублировать' : 'Дублировать (Про)'}
                  </button>
                  <button
                    className="template-card__menu-action"
                    type="button"
                    disabled={!canUseFolders}
                    onClick={() => {
                      setIsFolderPickerOpen((current) => !current);
                    }}
                  >
                    {canUseFolders ? 'Перенести в папку' : 'Папки (Про)'}
                  </button>

                  {isFolderPickerOpen && canUseFolders ? (
                    <div className="template-card__folder-picker">
                      <button
                        className={`template-card__folder-option ${template.folderId ? '' : 'template-card__folder-option_active'}`}
                        type="button"
                        onClick={() => {
                          onMoveToFolder(template, undefined);
                          setIsMenuOpen(false);
                          setIsFolderPickerOpen(false);
                        }}
                      >
                        Без папки
                      </button>
                      {folders.map((folder) => (
                        <button
                          key={folder.id}
                          className={`template-card__folder-option ${template.folderId === folder.id ? 'template-card__folder-option_active' : ''}`}
                          type="button"
                          onClick={() => {
                            onMoveToFolder(template, folder.id);
                            setIsMenuOpen(false);
                            setIsFolderPickerOpen(false);
                          }}
                        >
                          {folder.name}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <button
                    className="template-card__menu-action template-card__menu-action_danger"
                    type="button"
                    onClick={() => {
                      onDelete(template);
                      setIsMenuOpen(false);
                    }}
                  >
                    Удалить
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <p className="template-card__description">{safeDescription}</p>

          <div className="template-card__meta">
            <span className="template-card__meta-item">ID: {template.publicId}</span>
            <span className="template-card__meta-item">
              Публикация: {formatTemplateDate(template.publishedAt)}
            </span>
            <span className="template-card__meta-item">Изменил: {safeLastModifiedBy}</span>
          </div>
        </div>

        <div className="template-card__actions">
          <button
            className="template-card__button template-card__button_primary"
            type="button"
            onClick={() => onOpen(template)}
          >
            Быстрый просмотр
          </button>
          <button
            className="template-card__button template-card__button_secondary"
            type="button"
            onClick={() => onEdit(template)}
          >
            Редактировать
          </button>
        </div>
      </div>
    </article>
  );
};
