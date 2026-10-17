import { expect, test } from '@playwright/test';

test.use({ colorScheme: 'light' });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('textbox', { name: 'Math expression' }),
  ).toBeVisible();
});

test('keyboard input respects precedence and only saves submitted calculations', async ({
  page,
}) => {
  const input = page.getByRole('textbox', { name: 'Math expression' });
  await input.focus();
  await page.keyboard.type('2+3*4');

  await expect(input).toHaveValue('2+3×4');
  await expect(page.locator('#result')).toHaveText('14');
  await expect(page.locator('.history-item')).toHaveCount(0);

  await page.keyboard.press('Enter');
  await expect(page.locator('.history-item')).toHaveCount(1);
  await expect(page.locator('.history-item').first()).toContainText('14');
  await expect(page.locator('#live-indicator')).toHaveText('SOLVED');

  await page.keyboard.press('Enter');
  await expect(page.locator('.history-item')).toHaveCount(1);
});

test('keyboard supports grouping, powers, unary signs, scientific notation, and percentages', async ({
  page,
}) => {
  const input = page.getByRole('textbox', { name: 'Math expression' });
  const examples = [
    ['(2+3)*4', '20'],
    ['-2^2', '-4'],
    ['2^3^2', '512'],
    ['2^-2', '0.25'],
    ['1e-3+2E-3', '0.003'],
    ['200+10%', '200.1'],
    ['200*10%', '20'],
  ];

  for (const [expression, result] of examples) {
    await test.step(`${expression} = ${result}`, async () => {
      await input.press('Escape');
      await page.keyboard.type(expression);
      await page.keyboard.press('Enter');
      await expect(page.locator('#result')).toHaveText(result);
      await expect(input).not.toHaveAttribute('aria-invalid', 'true');
    });
  }
  await expect(page.locator('.history-item')).toHaveCount(examples.length);
});

test('the keypad calculates grouped expressions and toggles the result sign', async ({
  page,
}) => {
  const key = (name) => page.getByRole('button', { name, exact: true });
  for (const name of [
    'Open parenthesis',
    '2',
    'Add',
    '3',
    'Close parenthesis',
    'Multiply',
    '4',
  ]) {
    await key(name).click();
  }
  await key('Calculate result').click();
  await expect(page.locator('#expression')).toHaveValue('(2+3)×4');
  await expect(page.locator('#result')).toHaveText('20');

  await key('Toggle sign').click();
  await expect(page.locator('#result')).toHaveText('-20');
  await key('Toggle sign').click();
  await expect(page.locator('#result')).toHaveText('20');
});

test('toggle sign negates the whole expression when an initial group ends early', async ({
  page,
}) => {
  const input = page.getByRole('textbox', { name: 'Math expression' });
  await input.fill('−(2)+(3)');
  await expect(page.locator('#result')).toHaveText('1');

  await page.getByRole('button', { name: 'Toggle sign', exact: true }).click();
  await expect(page.locator('#result')).toHaveText('-1');
  await page.getByRole('button', { name: 'Toggle sign', exact: true }).click();
  await expect(page.locator('#result')).toHaveText('1');
  await expect(input).toHaveValue('−(2)+(3)');
  await expect(page.locator('.history-item')).toHaveCount(0);
});

test('keypad insertion and backspace preserve the expression caret and selection', async ({
  page,
}) => {
  const input = page.getByRole('textbox', { name: 'Math expression' });
  await input.fill('123+45');
  await input.press('Home');
  await input.press('ArrowRight');
  await input.press('ArrowRight');
  await page.getByRole('button', { name: 'Backspace', exact: true }).click();
  await expect(input).toHaveValue('13+45');
  await expect(page.locator('#result')).toHaveText('58');

  await input.press('End');
  await input.press('Shift+ArrowLeft');
  await input.press('Shift+ArrowLeft');
  await page.getByRole('button', { name: '7', exact: true }).click();
  await expect(input).toHaveValue('13+7');
  await expect(page.locator('#result')).toHaveText('20');

  await page
    .getByRole('button', { name: 'Clear all', exact: true })
    .first()
    .click();
  await expect(input).toHaveValue('');
  await expect(page.locator('#result')).toHaveText('0');
  await expect(page.locator('.history-item')).toHaveCount(0);
});

test('native keyboard deletion and Escape edit and clear the expression', async ({
  page,
}) => {
  const input = page.getByRole('textbox', { name: 'Math expression' });
  await input.fill('12+34');
  await input.press('End');
  await input.press('Backspace');
  await expect(input).toHaveValue('12+3');
  await expect(page.locator('#result')).toHaveText('15');
  await input.press('Home');
  await input.press('Delete');
  await expect(input).toHaveValue('2+3');
  await expect(page.locator('#result')).toHaveText('5');
  await input.press('Escape');
  await expect(input).toHaveValue('');
  await expect(page.locator('#result')).toHaveText('0');
});

test('a new digit starts fresh after equals while an operator continues the result', async ({
  page,
}) => {
  const input = page.getByRole('textbox', { name: 'Math expression' });
  await input.fill('2+3');
  await input.press('Enter');
  await page.keyboard.type('7');
  await expect(input).toHaveValue('7');
  await expect(page.locator('#result')).toHaveText('7');
  await page.keyboard.press('Enter');

  await page.keyboard.type('*4');
  await expect(input).toHaveValue('7×4');
  await page.keyboard.press('=');
  await expect(page.locator('#result')).toHaveText('28');
  await expect(page.locator('.history-item')).toHaveCount(3);

  await input.fill('-2');
  await input.press('Enter');
  await page.keyboard.type('^2');
  await page.keyboard.press('Enter');
  await expect(input).toHaveValue('(-2)^2');
  await expect(page.locator('#result')).toHaveText('4');
});

test('moving the caret after equals edits the existing expression', async ({
  page,
}) => {
  const input = page.getByRole('textbox', { name: 'Math expression' });
  await input.fill('2+3');
  await input.press('Enter');
  await input.press('Home');
  await page.keyboard.type('1');
  await expect(input).toHaveValue('12+3');
  await expect(page.locator('#result')).toHaveText('15');
  await expect(page.locator('.history-item')).toHaveCount(1);
});

test('selecting a submitted expression allows replacing it with a new number', async ({
  page,
}) => {
  const input = page.getByRole('textbox', { name: 'Math expression' });
  await input.fill('2+3');
  await input.press('Enter');
  await input.click();
  await input.press('ControlOrMeta+A');
  await page.keyboard.type('9');
  await expect(input).toHaveValue('9');
  await expect(page.locator('#result')).toHaveText('9');
  await expect(page.locator('.history-item')).toHaveCount(1);
});

test('division by zero shows a recoverable error without saving invalid history', async ({
  page,
}) => {
  const input = page.getByRole('textbox', { name: 'Math expression' });
  await input.fill('8/0');
  await input.press('Enter');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#calculation-message')).toContainText(
    'Cannot divide by zero',
  );
  await expect(page.locator('#result')).toHaveText('—');
  await expect(
    page.getByRole('button', { name: 'Copy result', exact: true }),
  ).toBeDisabled();
  await expect(page.locator('.history-item')).toHaveCount(0);

  await input.press('End');
  await input.press('Backspace');
  await page.keyboard.type('2');
  await input.press('Enter');
  await expect(page.locator('#result')).toHaveText('4');
  await expect(input).not.toHaveAttribute('aria-invalid', 'true');
  await expect(
    page.getByRole('button', { name: 'Copy result', exact: true }),
  ).toBeEnabled();
  await expect(page.locator('.history-item')).toHaveCount(1);
});

test('an incomplete expression stays editable and can be completed after submission', async ({
  page,
}) => {
  const input = page.getByRole('textbox', { name: 'Math expression' });
  await input.fill('(2+3');
  await expect(page.locator('#result')).toHaveText('—');
  await expect(page.locator('.history-item')).toHaveCount(0);
  await input.press('Enter');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await page.keyboard.type(')');
  await input.press('Enter');
  await expect(page.locator('#result')).toHaveText('5');
  await expect(page.locator('.history-item')).toHaveCount(1);
});

test('history persists, restores an editable expression, and clears across reloads', async ({
  page,
}) => {
  const input = page.getByRole('textbox', { name: 'Math expression' });
  await input.fill('6*7');
  await input.press('Enter');
  await input.fill('12/4');
  await input.press('Enter');
  await page.reload();
  await expect(page.locator('.history-item')).toHaveCount(2);
  await expect(page.locator('.history-item').first()).toContainText('12/4');

  await page
    .getByRole('button', { name: 'Reuse 6*7, result 42', exact: true })
    .click();
  await expect(input).toHaveValue('6*7');
  await expect(page.locator('#result')).toHaveText('42');
  await expect(input).toBeFocused();
  await expect(page.locator('.history-item')).toHaveCount(2);
  await page.keyboard.type('+1');
  await input.press('Enter');
  await expect(page.locator('#result')).toHaveText('43');

  await page.locator('#clear-history').click();
  await expect(page.locator('.history-item')).toHaveCount(0);
  await expect(page.locator('#history-empty')).toBeVisible();
  await expect(page.locator('#clear-history')).toBeDisabled();
  await expect(page.locator('#result')).toHaveText('43');
  await page.reload();
  await expect(page.locator('.history-item')).toHaveCount(0);
});

test('corrupt and injected history records are safely discarded', async ({
  page,
}) => {
  await page.evaluate(() => {
    localStorage.setItem(
      'forma.history.v1',
      JSON.stringify([
        {
          expression: '<img src=x onerror="window.injected=true">',
          result: '1',
        },
        { expression: '2+2', result: '5' },
        { expression: '3*3', result: '9' },
        null,
      ]),
    );
  });
  await page.reload();
  await expect(page.locator('.history-item')).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Reuse 3*3, result 9', exact: true }),
  ).toBeVisible();
  await expect(page.locator('#history-list img')).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();

  await page.evaluate(() =>
    localStorage.setItem('forma.history.v1', 'not-json'),
  );
  await page.reload();
  await expect(page.locator('.history-item')).toHaveCount(0);
  await expect(page.locator('#history-empty')).toBeVisible();
});

test('blocked device storage still allows calculations and history for the visit', async ({
  page,
}) => {
  await page.addInitScript(() => {
    for (const method of ['getItem', 'setItem']) {
      Object.defineProperty(Storage.prototype, method, {
        configurable: true,
        value() {
          throw new DOMException(
            'Device storage is unavailable.',
            'SecurityError',
          );
        },
      });
    }
  });
  await page.reload();
  const input = page.getByRole('textbox', { name: 'Math expression' });
  await input.fill('3*7');
  await input.press('Enter');
  await expect(page.locator('#result')).toHaveText('21');
  await expect(page.locator('.history-item')).toHaveCount(1);
  await expect(page.locator('#toast')).toContainText(
    'History is available for this visit',
  );

  await page
    .getByRole('button', { name: 'Reuse 3*7, result 21', exact: true })
    .click();
  await expect(input).toHaveValue('3*7');
  await page.locator('#clear-history').click();
  await expect(page.locator('.history-item')).toHaveCount(0);
  await expect(page.locator('#result')).toHaveText('21');
  await expect(page.locator('#toast')).toContainText(
    'Device storage is unavailable',
  );
});

test('history retains the most recent 30 submitted calculations', async ({
  page,
}) => {
  const input = page.getByRole('textbox', { name: 'Math expression' });
  for (let number = 1; number <= 31; number += 1) {
    await input.fill(`${number}+1`);
    await input.press('Enter');
  }
  await expect(page.locator('.history-item')).toHaveCount(30);
  await expect(page.locator('.history-item').first()).toContainText('31+1');
  await expect(page.locator('.history-item').last()).toContainText('2+1');
  await page.reload();
  await expect(page.locator('.history-item')).toHaveCount(30);
});

test('theme choice persists after reload and toggles its accessible label', async ({
  page,
}) => {
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page
    .getByRole('button', { name: 'Switch to dark theme', exact: true })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page
    .getByRole('button', { name: 'Switch to light theme', exact: true })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('the keyboard guide opens with ? and Escape closes it without clearing the expression', async ({
  page,
}) => {
  const input = page.getByRole('textbox', { name: 'Math expression' });
  await input.fill('2+3');
  await input.press('?');
  const dialog = page.getByRole('dialog', {
    name: 'A quicker way to clarity.',
  });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(input).toHaveValue('2+3');
  await expect(page.locator('#result')).toHaveText('5');
  await expect(input).toBeFocused();

  await page.getByRole('button', { name: /^Keyboard shortcuts/ }).click();
  await expect(dialog).toBeVisible();
  await page
    .getByRole('button', { name: 'Close keyboard shortcuts', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
});

test('copy actions copy the result and history value through the clipboard API', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.copiedResults = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.copiedResults.push(text);
        },
      },
    });
  });
  await page.getByRole('textbox', { name: 'Math expression' }).fill('8*9');
  await page.getByRole('button', { name: 'Copy result', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Result copied');
  expect(await page.evaluate(() => window.copiedResults)).toEqual(['72']);
  await expect(page.locator('.history-item')).toHaveCount(0);

  await page
    .getByRole('button', { name: 'Calculate result', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Copy result 72', exact: true })
    .click();
  expect(await page.evaluate(() => window.copiedResults)).toEqual(['72', '72']);
});

test('the example previews arithmetic without adding an unsubmitted history record', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Try example 2 plus 3 times 4', exact: true })
    .click();
  await expect(page.locator('#expression')).toHaveValue('2 + 3 × 4');
  await expect(page.locator('#result')).toHaveText('14');
  await expect(page.locator('#expression')).toBeFocused();
  await expect(page.locator('.history-item')).toHaveCount(0);
});

test.describe('mobile layout', () => {
  test.use({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
  });

  test('fits a narrow screen and supports tapping the keypad', async ({
    page,
  }) => {
    const horizontalOverflow = await page.evaluate(() => ({
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(horizontalOverflow.pageWidth).toBeLessThanOrEqual(
      horizontalOverflow.viewportWidth,
    );

    for (const name of ['7', 'Multiply', '8', 'Calculate result']) {
      const key = page.getByRole('button', { name, exact: true });
      await key.tap();
    }
    await expect(page.locator('#result')).toHaveText('56');
    await expect(page.locator('.history-item')).toHaveCount(1);

    const seven = await page
      .getByRole('button', { name: '7', exact: true })
      .boundingBox();
    expect(seven.width).toBeGreaterThanOrEqual(44);
    expect(seven.height).toBeGreaterThanOrEqual(44);
    await page.getByRole('button', { name: /^Keyboard shortcuts/ }).tap();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(375);
    await page
      .getByRole('button', { name: 'Close keyboard shortcuts', exact: true })
      .tap();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });
});
