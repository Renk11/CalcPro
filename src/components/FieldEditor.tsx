import {
  Button,
  Card,
  Checkbox,
  Div,
  FormItem,
  Input,
  Select,
} from '@vkontakte/vkui';
import type { CalculatorField, FieldType } from '../shared/types/calculator';

interface FieldEditorProps {
  field: CalculatorField;
  onChange: (field: CalculatorField) => void;
  onRemove: () => void;
}

const fieldTypeOptions: Array<{ label: string; value: FieldType }> = [
  { label: 'Число', value: 'number' },
  { label: 'Список', value: 'select' },
  { label: 'Чекбокс', value: 'checkbox' },
  { label: 'Текст', value: 'text' },
];

export const FieldEditor = ({ field, onChange, onRemove }: FieldEditorProps) => {
  const update = <K extends keyof CalculatorField>(key: K, value: CalculatorField[K]) => {
    onChange({ ...field, [key]: value });
  };

  const optionsText =
    field.options
      ?.map(
        (option) =>
          `${option.label}|${option.value}|${option.description ?? ''}|${option.image ?? ''}`,
      )
      .join('\n') ?? '';

  return (
    <Card mode="outline" className="field-editor">
      <Div>
        <FormItem top="Название поля">
          <Input value={field.label} onChange={(event) => update('label', event.target.value)} />
        </FormItem>
        <FormItem top="Описание">
          <Input
            value={field.description ?? ''}
            onChange={(event) => update('description', event.target.value)}
          />
        </FormItem>
        <FormItem top="Ключ">
          <Input value={field.key} onChange={(event) => update('key', event.target.value)} />
        </FormItem>
        <FormItem top="Тип поля">
          <Select
            value={field.type}
            options={fieldTypeOptions}
            onChange={(event) => update('type', event.target.value as FieldType)}
          />
        </FormItem>
        <FormItem top="Текст внутри поля">
          <Input
            value={field.placeholder ?? ''}
            onChange={(event) => update('placeholder', event.target.value)}
          />
        </FormItem>
        {field.type === 'select' ? (
          <>
            <FormItem top="Значение по умолчанию">
              <Input
                value={String(field.defaultValue ?? '')}
                onChange={(event) => update('defaultValue', event.target.value)}
              />
            </FormItem>
            <FormItem top="Варианты списка">
              <textarea
                className="field-editor__textarea"
                value={optionsText}
                onChange={(event) => {
                  const nextOptions = event.target.value
                    .split('\n')
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .map((line, index) => {
                      const [label, value, description, image] = line.split('|');
                      const numericValue = Number(value);
                      return {
                        id: `${field.id}-option-${index}`,
                        label: label || `Опция ${index + 1}`,
                        value: Number.isFinite(numericValue) && value !== '' ? numericValue : value,
                        description: description || undefined,
                        image: image || undefined,
                      };
                    });

                  update('options', nextOptions);
                }}
              />
            </FormItem>
            <Checkbox
              checked={Boolean(field.showOptionPrices)}
              onChange={(event) => update('showOptionPrices', event.target.checked)}
            >
              Показывать цену рядом с вариантом
            </Checkbox>
            <Checkbox
              checked={field.useValueInFormula !== false}
              onChange={(event) => update('useValueInFormula', event.target.checked)}
            >
              Использовать выбранное значение в формуле
            </Checkbox>
          </>
        ) : null}
        <Checkbox checked={field.required} onChange={(event) => update('required', event.target.checked)}>
          Обязательное поле
        </Checkbox>
        <div className="field-editor__remove">
          <Button mode="secondary" size="s" onClick={onRemove}>
            Удалить поле
          </Button>
        </div>
      </Div>
    </Card>
  );
};
