import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'calcpro-formulas-'));
const outDir = path.join(tempRoot, 'out');

try {
  const runtimeFiles = [
    'src/entities/calculator/model.ts',
    'src/entities/calculator/booking.ts',
    'src/shared/randomId.ts',
  ];

  runtimeFiles.forEach((relativePath) => {
    const sourcePath = path.join(repoRoot, relativePath);
    const outputPath = path.join(outDir, relativePath.replace(/\.ts$/, '.js'));
    const sourceText = readFileSync(sourcePath, 'utf8').replace(
      /(from\s+['"])(\.{1,2}\/[^'"]+?)(['"])/g,
      '$1$2.js$3',
    );
    const transpiled = ts.transpileModule(sourceText, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ES2020,
      },
      fileName: sourcePath,
    });

    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, transpiled.outputText);
  });

  writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'module' }, null, 2));

  const modelModule = await import(
    pathToFileURL(path.join(outDir, 'src/entities/calculator/model.js')).href
  );

  const { evaluateFormulaExpression } = modelModule;

  const baseTemplate = {
    basePrice: 10,
    globalCoefficient: 1,
    fields: [],
  };

  const makeField = (overrides) => ({
    id: overrides.id ?? overrides.key,
    key: overrides.key,
    label: overrides.label,
    type: overrides.type ?? 'slider',
    required: false,
    unitPrice: 0,
    coefficient: 1,
    useValueInFormula: true,
    options: [],
    ...overrides,
  });

  const evaluate = (expression, { template = baseTemplate, values = {}, expectedError = '' } = {}) => {
    const result = evaluateFormulaExpression(expression, template, values);

    if (expectedError) {
      assert.equal(result.error, expectedError, `"${expression}" should fail with "${expectedError}"`);
      return result;
    }

    assert.equal(result.error, '', `"${expression}" should not produce an error`);
    return result;
  };

  const approx = (actual, expected, expression) => {
    assert.ok(
      Math.abs(actual - expected) < 1e-9,
      `${expression}: expected ${expected}, received ${actual}`,
    );
  };

  const cases = [
    () => approx(evaluate('1 + 2 * 3').value, 7, '1 + 2 * 3'),
    () => approx(evaluate('(1 + 2) * 3').value, 9, '(1 + 2) * 3'),
    () => approx(evaluate('10 / 2 + 3').value, 8, '10 / 2 + 3'),
    () => approx(evaluate('-5 + 12').value, 7, '-5 + 12'),
    () => approx(evaluate('1,5 + 2').value, 3.5, '1,5 + 2'),
    () => approx(evaluate('2 > 1').value, 1, '2 > 1'),
    () => approx(evaluate('2 < 1').value, 0, '2 < 1'),
    () => approx(evaluate('2 >= 2').value, 1, '2 >= 2'),
    () => approx(evaluate('2 != 3').value, 1, '2 != 3'),
    () => approx(evaluate('(2 > 1) && (3 > 2)').value, 1, '(2 > 1) && (3 > 2)'),
    () => approx(evaluate('(2 > 3) || (3 > 2)').value, 1, '(2 > 3) || (3 > 2)'),
    () => approx(evaluate('ifElse(2 > 1, 50, 10)').value, 50, 'ifElse(2 > 1, 50, 10)'),
    () => approx(evaluate('Если(2 > 1, 50, 10)').value, 50, 'Если(2 > 1, 50, 10)'),
    () => approx(evaluate('Мин(7, 2, 5)').value, 2, 'Мин(7, 2, 5)'),
    () => approx(evaluate('Макс(7, 2, 5)').value, 7, 'Макс(7, 2, 5)'),
    () => approx(evaluate('Округл(10 / 3, 2)').value, 3.33, 'Округл(10 / 3, 2)'),
    () => approx(evaluate('Модуль(-12)').value, 12, 'Модуль(-12)'),
    () =>
      approx(
        evaluate('(Базовая цена * Ползунок) + Дополнительная опция', {
          template: {
            ...baseTemplate,
            fields: [
              makeField({ key: 'range', label: 'Ползунок', type: 'slider' }),
              makeField({
                key: 'check',
                label: 'Дополнительная опция',
                type: 'checkbox',
                options: [{ id: 'opt-1', label: 'Вариант 1', value: 100 }],
              }),
            ],
          },
          values: {
            range: 42,
            check: ['opt-1'],
          },
        }).value,
        520,
        '(Базовая цена * Ползунок) + Дополнительная опция',
      ),
    () =>
      approx(
        evaluate('Базовая цена + Цена', {
          template: {
            ...baseTemplate,
            fields: [makeField({ key: 'price', label: 'Цена', type: 'slider' })],
          },
          values: { price: 5 },
        }).value,
        15,
        'Базовая цена + Цена',
      ),
    () =>
      approx(
        evaluate('Стоимость + Стоимость доставки', {
          template: {
            ...baseTemplate,
            fields: [
              makeField({ key: 'cost', label: 'Стоимость', type: 'slider' }),
              makeField({ key: 'shipping', label: 'Стоимость доставки', type: 'slider' }),
            ],
          },
          values: { cost: 100, shipping: 250 },
        }).value,
        350,
        'Стоимость + Стоимость доставки',
      ),
    () =>
      approx(
        evaluate('base + Базовая цена', {
          template: {
            ...baseTemplate,
            fields: [makeField({ key: 'base', label: 'base', type: 'slider' })],
          },
          values: { base: 7 },
        }).value,
        17,
        'base + Базовая цена',
      ),
    () =>
      evaluate('10 / 0', {
        expectedError: 'Деление на ноль',
      }),
    () =>
      evaluate('(1 + 2', {
        expectedError: 'Не закрыта скобка в формуле',
      }),
  ];

  cases.forEach((runCase) => runCase());
  console.log(`Formula checks passed: ${cases.length}`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
