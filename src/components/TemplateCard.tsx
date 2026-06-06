import { useEffect, useRef, useState } from 'react';
import type { CalculatorFolder, CalculatorTemplate } from '../shared/types/calculator';

interface TemplateCardProps {
  template: CalculatorTemplate;
  folders: CalculatorFolder[];
  onOpen: (template: CalculatorTemplate) => void;
  onEdit: (template: CalculatorTemplate) => void;
  onDuplicate: (template: CalculatorTemplate) => void;
  onDelete: (template: CalculatorTemplate) => void;
  onMoveToFolder: (template: CalculatorTemplate, folderId?: string) => void;
}

export const TemplateCard = ({
  template,
  folders,
  onOpen,
  onEdit,
  onDuplicate,
  onDelete,
  onMoveToFolder,
}: TemplateCardProps) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

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
    <article className="template-card">
      <div className="template-card__content">
        <div className="template-card__header">
          <div className="template-card__head-row">
            <h3 className="template-card__title">{template.title}</h3>
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
                ⋯
              </button>

              {isMenuOpen ? (
                <div className="template-card__menu-popover">
                  <button
                    className="template-card__menu-action"
                    type="button"
                    onClick={() => {
                      onDuplicate(template);
                      setIsMenuOpen(false);
                    }}
                  >
                    Дублировать
                  </button>
                  <button
                    className="template-card__menu-action"
                    type="button"
                    onClick={() => setIsFolderPickerOpen((current) => !current)}
                  >
                    Перенести в папку
                  </button>

                  {isFolderPickerOpen ? (
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
          <p className="template-card__description">{template.description}</p>
        </div>

        <div className="template-card__actions">
          <button
            className="template-card__button template-card__button_primary"
            type="button"
            onClick={() => onOpen(template)}
          >
            Открыть
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
