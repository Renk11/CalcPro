import { useEffect, useMemo, useState } from 'react';
import { CalculatorFieldInput } from '../components/CalculatorFieldInput';
import {
  buildBookingSlots,
  isBookingDateSelectable,
  isBookingValue,
} from '../entities/calculator/booking';
import { calculateTemplate } from '../entities/calculator/model';
import { submitRequest } from '../entities/calculator/submission';
import { legalDocs, type LegalDocKey } from '../shared/legal';
import { getRequests } from '../shared/storage/localStorage';
import type {
  CalculatorField,
  CalculatorFieldValue,
  CalculatorRequest,
  CalculatorTemplate,
  CalculatorUploadedFile,
  CalculatorValues,
} from '../shared/types/calculator';

interface CalculatorPageProps {
  template: CalculatorTemplate;
  onOpenAdmin?: () => void;
  onRequestCreated: (request: CalculatorRequest) => void;
}

const getInputSubtype = (field: CalculatorField) => {
  if (field.type === 'input') {
    return field.inputSubtype ?? 'text';
  }

  if (field.type === 'number') {
    return 'number';
  }

  if (field.type === 'text') {
    return 'text';
  }

  return null;
};

const isUploadedFileArray = (value: CalculatorFieldValue): value is CalculatorUploadedFile[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      'name' in item &&
      'size' in item &&
      'type' in item,
  );

const getInitialFieldValue = (field: CalculatorField): CalculatorFieldValue => {
  if (field.defaultValue !== undefined) {
    return field.defaultValue;
  }

  if (field.type === 'result') {
    return '';
  }

  if (field.type === 'booking') {
    return '';
  }

  if (field.type === 'input' && field.inputSubtype === 'file') {
    return [];
  }

  if (field.type === 'checkbox') {
    if ((field.options?.length ?? 0) > 0) {
      return field.defaultValue === true ? ['__primary__'] : [];
    }

    return false;
  }

  if (field.type === 'button') {
    return '';
  }

  return '';
};

const normalizeSummaryLabel = (value: string) => value.trim().toLowerCase();

const validateFieldValue = (
  field: CalculatorField,
  value: CalculatorFieldValue,
  templateId: string,
  requests: CalculatorRequest[],
) => {
  if (field.type === 'button' || field.type === 'result') {
    return '';
  }

  const inputSubtype = getInputSubtype(field);

  if (field.required) {
    const isEmpty =
      field.type === 'checkbox'
        ? false
        : Array.isArray(value)
          ? value.length === 0
          : value === '' || value === undefined || value === null;

    if (isEmpty) {
      return 'Поле обязательно для заполнения';
    }
  }

  if (field.type === 'booking') {
    if (!isBookingValue(value)) {
      return field.required ? 'Выберите дату и время записи' : '';
    }

    if (!isBookingDateSelectable(field, value.date, templateId, requests)) {
      return 'На выбранную дату нет доступных слотов';
    }

    const slot = buildBookingSlots(field, value.date, templateId, requests).find(
      (item) => item.dateTime === value.dateTime,
    );

    if (!slot?.isAvailable) {
      return 'Выбранный слот уже недоступен';
    }

    return '';
  }

  if (!inputSubtype) {
    return '';
  }

  if (inputSubtype === 'number') {
    if (value === '' || value === undefined || value === null) {
      return '';
    }

    const numericValue = Number(value);

    if (Number.isNaN(numericValue)) {
      return 'Введите корректное число';
    }

    if (field.min !== undefined && numericValue < field.min) {
      return `Минимум: ${field.min}`;
    }

    if (field.max !== undefined && numericValue > field.max) {
      return `Максимум: ${field.max}`;
    }

    return '';
  }

  if (inputSubtype === 'file') {
    if (!isUploadedFileArray(value) || value.length === 0) {
      return '';
    }

    if (field.maxFileSizeMb) {
      const maxSizeBytes = field.maxFileSizeMb * 1024 * 1024;
      const oversizedFile = value.find((file) => file.size > maxSizeBytes);
      if (oversizedFile) {
        return `Файл "${oversizedFile.name}" больше ${field.maxFileSizeMb} МБ`;
      }
    }

    if (field.fileAccept?.trim()) {
      const rules = field.fileAccept
        .split(',')
        .map((rule) => rule.trim().toLowerCase())
        .filter(Boolean);

      const invalidFile = value.find((file) => {
        const fileName = file.name.toLowerCase();
        const fileType = file.type.toLowerCase();

        return !rules.some((rule) => {
          if (rule.endsWith('/*')) {
            return fileType.startsWith(rule.slice(0, -1));
          }

          if (rule.startsWith('.')) {
            return fileName.endsWith(rule);
          }

          return fileType === rule;
        });
      });

      if (invalidFile) {
        return `Файл "${invalidFile.name}" не подходит по типу`;
      }
    }

    return '';
  }

  const textValue = String(value ?? '');

  if (field.minLength && textValue.length < field.minLength) {
    return `Минимальная длина: ${field.minLength}`;
  }

  if (field.maxLength && textValue.length > field.maxLength) {
    return `Максимальная длина: ${field.maxLength}`;
  }

  if (inputSubtype === 'phone' && field.validatePhone !== false && textValue) {
    const normalized = textValue.replace(/[\s()-]/g, '');
    if (!/^(?:\+)?(?:79|89)\d{9}$/.test(normalized)) {
      return 'Введите корректный телефон';
    }
  }

  if (inputSubtype === 'email' && field.validateEmail !== false && textValue) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(textValue)) {
      return 'Введите корректную эл. почту';
    }
  }

  return '';
};

const createInitialValues = (template: CalculatorTemplate): CalculatorValues =>
  template.fields.reduce<CalculatorValues>((acc, field) => {
    acc[field.key] = getInitialFieldValue(field);
    return acc;
  }, {});

const COMMENT_MAX_LENGTH = 250;
const getPhoneValidationError = (value: string) => {
  const normalized = value.replace(/[\s()-]/g, '');

  if (!normalized) {
    return '';
  }

  if (!/^(?:\+)?(?:79|89)\d{9}$/.test(normalized)) {
    return 'Телефон должен начинаться с 79, 89, +79 или +89';
  }

  return '';
};

export const CalculatorPage = ({ template, onOpenAdmin, onRequestCreated }: CalculatorPageProps) => {
  const [values, setValues] = useState<CalculatorValues>(() => createInitialValues(template));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [requests, setRequests] = useState<CalculatorRequest[]>(() => getRequests());
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCalculationTriggered, setIsCalculationTriggered] = useState(false);
  const [isConsentChecked, setIsConsentChecked] = useState(false);
  const [consentError, setConsentError] = useState('');
  const [activeLegalDoc, setActiveLegalDoc] = useState<LegalDocKey | null>(null);
  const phoneError = useMemo(() => getPhoneValidationError(phone), [phone]);

  useEffect(() => {
    const body = document.body;
    const root = document.getElementById('root');
    const previousBodyOverflow = body.style.overflow;
    const previousBodyMinHeight = body.style.minHeight;
    const previousRootHeight = root?.style.height ?? '';
    const previousRootOverflow = root?.style.overflow ?? '';

    body.style.overflow = 'auto';
    body.style.minHeight = '100dvh';

    if (root) {
      root.style.height = 'auto';
      root.style.overflow = 'visible';
    }

    return () => {
      body.style.overflow = previousBodyOverflow;
      body.style.minHeight = previousBodyMinHeight;

      if (root) {
        root.style.height = previousRootHeight;
        root.style.overflow = previousRootOverflow;
      }
    };
  }, []);

  const result = useMemo(() => calculateTemplate(template, values), [template, values]);

  const missingRequestItems = useMemo(() => {
    const items = template.fields
      .filter((field) => field.type !== 'button' && field.type !== 'result')
      .filter((field) =>
        Boolean(
          validateFieldValue(
            field,
            values[field.key] ?? getInitialFieldValue(field),
            template.id,
            requests,
          ),
        ),
      )
      .map((field) => normalizeSummaryLabel(field.label))
      .filter(Boolean);

    if (!name.trim()) {
      items.push(normalizeSummaryLabel(template.requestForm.nameLabel));
    }

    if (!phone.trim() || phoneError) {
      items.push(normalizeSummaryLabel(template.requestForm.phoneLabel));
    }

    if (!isConsentChecked) {
      items.push('согласие');
    }

    return [...new Set(items)];
  }, [
    isConsentChecked,
    name,
    phone,
    phoneError,
    requests,
    template.fields,
    template.id,
    template.requestForm.nameLabel,
    template.requestForm.phoneLabel,
    values,
  ]);

  const resultCardTitle = (template.resultCardTitle ?? '').trim() || 'Итог расчета';
  const resultCardDescription = status
    ? status
    : missingRequestItems.length > 0
      ? `Нужно заполнить: ${missingRequestItems.join(', ')}`
      : template.requestForm.enabled
        ? 'Все данные заполнены, можно отправить заявку.'
        : 'Результат расчета обновляется автоматически.';

  const isRequestSubmitDisabled = !name || !phone || Boolean(phoneError) || isSubmitting;
  const shouldShowResultDetails = !template.requestForm.enabled || missingRequestItems.length === 0;

  const validate = () => {
    const nextErrors: Record<string, string> = {};

    template.fields.forEach((field) => {
      const error = validateFieldValue(
        field,
        values[field.key] ?? getInitialFieldValue(field),
        template.id,
        requests,
      );
      if (error) {
        nextErrors[field.key] = error;
      }
    });

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const isTemplateValid = useMemo(
    () =>
      template.fields
        .filter((field) => field.type !== 'button')
        .every(
          (field) =>
            !validateFieldValue(
              field,
              values[field.key] ?? getInitialFieldValue(field),
              template.id,
              requests,
            ),
        ),
    [requests, template.fields, template.id, values],
  );

  const handleSubmit = async () => {
    if (!validate()) {
      setStatus('Заполните обязательные поля');
      return;
    }

    if (phoneError) {
      setStatus(phoneError);
      return;
    }

    if (!isConsentChecked) {
      setConsentError('Подтвердите согласие перед отправкой заявки');
      setStatus('');
      return;
    }

    setIsSubmitting(true);

    const request: CalculatorRequest = {
      id: crypto.randomUUID(),
      templateId: template.id,
      templateTitle: template.title,
      name,
      phone,
      comment,
      amount: result.total,
      createdAt: new Date().toISOString(),
      values,
    };

    try {
      const response = await submitRequest(request);
      setRequests((current) => [request, ...current]);
      onRequestCreated(request);
      setStatus(response.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetCalculator = () => {
    setValues(createInitialValues(template));
    setErrors({});
    setName('');
    setPhone('');
    setComment('');
    setStatus('');
    setIsConsentChecked(false);
    setConsentError('');
    setIsCalculationTriggered(false);
  };

  const handleButtonAction = async (
    action: NonNullable<CalculatorField['buttonAction']>,
    field: CalculatorField,
  ) => {
    switch (action) {
      case 'submit':
        await handleSubmit();
        break;
      case 'reset':
        resetCalculator();
        break;
      case 'link':
      case 'vk':
        if (field.buttonUrl?.trim()) {
          window.open(field.buttonUrl, '_blank', 'noopener,noreferrer');
        }
        break;
      case 'copy':
        try {
          await navigator.clipboard.writeText(`${result.total} ₽`);
          setStatus('Результат скопирован');
        } catch {
          setStatus('Не удалось скопировать результат');
        }
        break;
      case 'calculate':
      default:
        if (!validate()) {
          setStatus('Заполните обязательные поля');
        } else {
          setIsCalculationTriggered(true);
          setStatus(`Итог: ${result.total} ₽`);
        }
        break;
    }
  };

  return (
    <div className="calculator-page">
      <div className="calculator-page__shell">
        <div className="calculator-page__hero">
          {onOpenAdmin ? (
            <div className="calculator-page__actions">
              <button className="calculator-page__back" type="button" onClick={onOpenAdmin}>
                Админка
              </button>
            </div>
          ) : null}
          <div className="calculator-page__hero-copy">
            <div className="calculator-page__eyebrow">Расчет стоимости</div>
            <h1 className="calculator-page__title">{template.title}</h1>
            <p className="calculator-page__description">{template.description}</p>
          </div>
        </div>

        <div className="calculator-layout">
          <section className="calculator-layout__form">
            <div className="calculator-panel">
              <div className="calculator-panel__head">
                <h2 className="calculator-panel__title">Параметры</h2>
                <div className="calculator-panel__caption">
                  Заполните поля, чтобы увидеть стоимость
                </div>
              </div>

              <div className="calculator-fields">
                {template.fields.map((field) => (
                  <div
                    key={field.id}
                    className={`calculator-fields__item calculator-fields__item_${field.layout === 'half' ? 'half' : 'full'}`}
                    style={{
                      marginTop: `${Math.max(0, field.marginTop ?? 0)}px`,
                      marginBottom: `${Math.max(0, field.marginBottom ?? 0)}px`,
                      marginLeft: `${Math.max(0, field.marginLeft ?? 0)}px`,
                      marginRight: `${Math.max(0, field.marginRight ?? 0)}px`,
                    }}
                  >
                    <CalculatorFieldInput
                      field={field}
                      value={values[field.key] ?? getInitialFieldValue(field)}
                      error={errors[field.key]}
                      isFormValid={isTemplateValid}
                      template={template}
                      allValues={values}
                      isCalculationTriggered={isCalculationTriggered}
                      templateId={template.id}
                      bookingRequests={requests}
                      onButtonAction={handleButtonAction}
                      onChange={(value) => {
                        setIsCalculationTriggered(false);
                        setValues((current) => ({
                          ...current,
                          [field.key]: value,
                        }));
                        setErrors((current) => {
                          if (!current[field.key]) {
                            return current;
                          }

                          const nextError = validateFieldValue(
                            field,
                            value,
                            template.id,
                            requests,
                          );
                          const next = { ...current };
                          if (nextError) {
                            next[field.key] = nextError;
                          } else {
                            delete next[field.key];
                          }
                          return next;
                        });
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div
              className="calculator-panel"
              style={template.requestForm.enabled ? undefined : { display: 'none' }}
            >
              <div className="calculator-panel__head">
                <h2 className="calculator-panel__title">{template.requestForm.title}</h2>
                <div className="calculator-panel__caption">
                  {template.requestForm.description}
                </div>
              </div>

              <div className="calculator-request">
                <label className="calc-field">
                  <span className="calc-field__label">{template.requestForm.nameLabel}</span>
                  <input
                    className="calc-field__control"
                    value={name}
                    placeholder={template.requestForm.namePlaceholder}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>

                <label className="calc-field">
                  <span className="calc-field__label">{template.requestForm.phoneLabel}</span>
                  <input
                    className="calc-field__control"
                    value={phone}
                    placeholder={template.requestForm.phonePlaceholder}
                    onChange={(event) => setPhone(event.target.value)}
                  />
                  {phoneError ? <span className="error-text">{phoneError}</span> : null}
                </label>

                <label className="calc-field">
                  <span className="calc-field__label">{template.requestForm.commentLabel}</span>
                  <textarea
                    className="calc-field__control calc-field__control_textarea"
                    value={comment}
                    maxLength={COMMENT_MAX_LENGTH}
                    placeholder={template.requestForm.commentPlaceholder}
                    onChange={(event) => setComment(event.target.value.slice(0, COMMENT_MAX_LENGTH))}
                  />
                  <span className="calc-field__hint">
                    {comment.length} / {COMMENT_MAX_LENGTH}
                  </span>
                </label>

                <label className={`calculator-request__consent ${consentError ? 'calculator-request__consent_error' : ''}`}>
                  <span className="calculator-request__consent-row">
                    <input
                      className="calculator-request__consent-checkbox"
                      type="checkbox"
                      checked={isConsentChecked}
                      onChange={(event) => {
                        setIsConsentChecked(event.target.checked);
                        if (event.target.checked) {
                          setConsentError('');
                        }
                      }}
                    />
                    <span className="calculator-request__consent-text">
                      Я принимаю{' '}
                      <button
                        className="calculator-request__consent-link"
                        type="button"
                        onClick={() => setActiveLegalDoc('agreement')}
                      >
                        пользовательское соглашение
                      </button>{' '}
                      и{' '}
                      <button
                        className="calculator-request__consent-link"
                        type="button"
                        onClick={() => setActiveLegalDoc('privacy')}
                      >
                        политику конфиденциальности
                      </button>
                    </span>
                  </span>
                  {consentError ? (
                    <span className="calculator-request__consent-error">{consentError}</span>
                  ) : null}
                </label>

              </div>
            </div>
          </section>

          {template.resultCardShow !== false ? (
            <aside className="calculator-layout__result">
                <div className="result-card result-card_sticky">
                <div className="result-card__content">
                  {template.resultCardShowTitle !== false ? (
                    <div className="result-card__eyebrow">{resultCardTitle}</div>
                  ) : null}
                  {template.resultCardShowTotal !== false ? (
                    <div className="result-card__amount result-card__amount_compact">{`${result.total} ₽`}</div>
                  ) : null}
                  <div className="result-card__description">{resultCardDescription}</div>
                  {shouldShowResultDetails ? (
                    <div className="result-card__list result-card__list_compact">
                      {template.resultCardShowSubtotal !== false ? (
                        <div className="result-card__row">
                          <span>{template.resultSubtotalLabel ?? 'Подытог'}</span>
                          <strong>{result.subtotal} ₽</strong>
                        </div>
                      ) : null}
                      {template.resultCardShowDiscount !== false ? (
                        <div className="result-card__row">
                          <span>{template.resultDiscountLabel ?? 'Скидка'}</span>
                          <strong>{result.discountAmount} ₽</strong>
                        </div>
                      ) : null}
                      {template.resultCardShowMinPrice !== false ? (
                        <div className="result-card__row">
                          <span>{template.resultMinPriceLabel ?? 'Минимальная цена'}</span>
                          <strong>{template.minPrice} ₽</strong>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {template.requestForm.enabled ? (
                  <button
                    className="calculator-request__submit result-card__submit"
                    type="button"
                    onClick={handleSubmit}
                    disabled={isRequestSubmitDisabled}
                  >
                    {template.requestForm.submitButtonText}
                  </button>
                ) : null}
              </div>
            </aside>
          ) : null}
        </div>
      </div>
      {activeLegalDoc ? (
        <div className="admin-modal" role="dialog" aria-modal="true">
          <div className="admin-modal__backdrop" onClick={() => setActiveLegalDoc(null)} />
          <div className="admin-modal__card admin-modal__card_wide calculator-legal-modal">
            <div className="admin-modal__eyebrow">{legalDocs[activeLegalDoc].caption}</div>
            <h3 className="admin-modal__title">{legalDocs[activeLegalDoc].title}</h3>
            <p className="admin-modal__text">{legalDocs[activeLegalDoc].intro}</p>
            <div className="calculator-legal-modal__sections">
              {legalDocs[activeLegalDoc].sections.map((section) => (
                <section key={section.title} className="calculator-legal-modal__section">
                  <h4 className="calculator-legal-modal__section-title">{section.title}</h4>
                  <ul className="calculator-legal-modal__list">
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <div className="admin-modal__actions">
              <button
                className="admin-modal__button admin-modal__button_secondary"
                type="button"
                onClick={() => setActiveLegalDoc(null)}
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
