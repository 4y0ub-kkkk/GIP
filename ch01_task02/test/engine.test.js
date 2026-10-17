import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CalculatorError,
  evaluateExpression,
  formatResult,
} from '../js/engine.js';

const cases = [
  ['2 + 3 × 4', 14],
  ['(2 + 3) × 4', 20],
  ['10 - 6 / 2', 7],
  ['12 / 3 * 2', 8],
  ['10 - 3 - 2', 5],
  ['2^3^2', 512],
  ['(2^3)^2', 64],
  ['-2^2', -4],
  ['(-2)^2', 4],
  ['2^-2', 0.25],
  ['-2^-2', -0.25],
  ['2^-2^2', 0.0625],
  ['3 * -2^2', -12],
  ['-(2 + 3)', -5],
  ['2--3', 5],
  ['2+-3', -1],
  ['+ + 2', 2],
  ['.5 + .25', 0.75],
  ['5. + 0.125', 5.125],
  ['0002 + 03', 5],
  ['1e3 + 2E+2', 1200],
  ['1e−3 × 1000', 1],
  ['8 ÷ 2 − 1', 3],
  ['50%', 0.5],
  ['200 * 10%', 20],
  ['200 + 10%', 200.1],
  ['(10 + 40)%', 0.5],
  ['-50%', -0.5],
  ['50%%', 0.005],
  ['2^50%', Math.sqrt(2)],
  ['2(3 + 4)', 14],
  ['(2 + 3)(4 - 1)', 15],
  ['(2 + 3)4', 20],
  ['2(-3)', -6],
  ['6/2(1+2)', 9],
  ['  \t 7 +\n 3  ', 10],
  ['0^0', 1],
  ['(-2)^3', -8],
  ['1e-300 / 10', 1e-301],
];

for (const [expression, expected] of cases) {
  test(`evaluates ${expression.replace(/\s+/g, ' ').trim()}`, () => {
    assert.equal(evaluateExpression(expression), expected);
  });
}

const errors = [
  ['', 'EMPTY_EXPRESSION'],
  ['   ', 'EMPTY_EXPRESSION'],
  [null, 'INVALID_EXPRESSION'],
  [42, 'INVALID_EXPRESSION'],
  ['2+', 'INCOMPLETE_EXPRESSION'],
  ['2^', 'INCOMPLETE_EXPRESSION'],
  ['-', 'INCOMPLETE_EXPRESSION'],
  ['1e+', 'INCOMPLETE_EXPRESSION'],
  ['1e', 'INCOMPLETE_EXPRESSION'],
  ['(2 + 3', 'UNMATCHED_PARENTHESIS'],
  ['2 + 3)', 'UNMATCHED_PARENTHESIS'],
  ['()', 'EMPTY_PARENTHESES'],
  ['(2+)', 'UNEXPECTED_PARENTHESIS'],
  ['*2', 'UNEXPECTED_OPERATOR'],
  ['2**3', 'UNEXPECTED_OPERATOR'],
  ['%2', 'UNEXPECTED_OPERATOR'],
  ['2 3', 'MISSING_OPERATOR'],
  ['1.2.3', 'MISSING_OPERATOR'],
  ['(2 3)', 'MISSING_OPERATOR'],
  ['.', 'INVALID_NUMBER'],
  ['2,000', 'INVALID_CHARACTER'],
  ['Math.sqrt(4)', 'INVALID_CHARACTER'],
  ['alert(1)', 'INVALID_CHARACTER'],
  ['2; 3', 'INVALID_CHARACTER'],
  ['2 / 0', 'DIVISION_BY_ZERO'],
  ['1 / -0', 'DIVISION_BY_ZERO'],
  ['0 / 0', 'DIVISION_BY_ZERO'],
  ['8 / (3 - 3)', 'DIVISION_BY_ZERO'],
  ['(-1)^.5', 'INVALID_RESULT'],
  ['2^1024', 'OUT_OF_RANGE'],
  ['1e309', 'OUT_OF_RANGE'],
  ['1e308 * 10', 'OUT_OF_RANGE'],
  ['0^-1', 'OUT_OF_RANGE'],
];

for (const [expression, code] of errors) {
  test(`rejects ${JSON.stringify(expression)} with ${code}`, () => {
    assert.throws(
      () => evaluateExpression(expression),
      (error) => {
        assert.ok(error instanceof CalculatorError);
        assert.equal(error.name, 'CalculatorError');
        assert.equal(error.code, code);
        assert.ok(error.message.length > 0);
        return true;
      },
    );
  });
}

test('limits input length before attempting to parse', () => {
  assert.throws(() => evaluateExpression('1'.repeat(513)), {
    code: 'INPUT_TOO_LONG',
  });
});

test('limits token count independently from input length', () => {
  assert.throws(() => evaluateExpression('1+'.repeat(128) + '1'), {
    code: 'TOO_COMPLEX',
  });
});

test('limits recursive nesting without a native stack overflow', () => {
  assert.throws(
    () => evaluateExpression('('.repeat(65) + '1' + ')'.repeat(65)),
    {
      code: 'TOO_COMPLEX',
    },
  );
  assert.throws(() => evaluateExpression('-'.repeat(65) + '1'), {
    code: 'TOO_COMPLEX',
  });
});

test('supports ordinary expressions close to the token bound', () => {
  assert.equal(evaluateExpression(Array(128).fill('1').join('+')), 128);
});

test('normalizes negative zero in both results and formatting', () => {
  assert.equal(Object.is(evaluateExpression('-0'), -0), false);
  assert.equal(Object.is(evaluateExpression('0 * -2'), -0), false);
  assert.equal(formatResult(-0), '0');
});

test('removes common floating point display artifacts', () => {
  assert.equal(formatResult(evaluateExpression('0.1+0.2')), '0.3');
  assert.equal(formatResult(evaluateExpression('1/3')), '0.333333333333');
  assert.equal(formatResult(evaluateExpression('1.005*100')), '100.5');
  assert.equal(formatResult(1234.5), '1234.5');
});

test('preserves small and scientific values in display output', () => {
  assert.equal(formatResult(1e-20), '1e-20');
  assert.equal(formatResult(1e21), '1e+21');
  assert.equal(formatResult(Number.MIN_VALUE), '5e-324');
  assert.equal(formatResult(1.234567890123e-12), '1.23456789012e-12');
  assert.ok(
    Number.isFinite(evaluateExpression(formatResult(Number.MAX_VALUE))),
  );
  assert.ok(
    Number.isFinite(evaluateExpression(formatResult(-Number.MAX_VALUE))),
  );
});

test('formatted history values can safely be used in later expressions', () => {
  for (const original of [1e-20, 1e21, -1e22, 0.1 + 0.2, 1 / 3]) {
    const formatted = formatResult(original);
    assert.equal(evaluateExpression(`(${formatted})*2`), Number(formatted) * 2);
  }
});

test('rejects nonfinite or nonnumeric values passed to the formatter', () => {
  for (const value of [Infinity, -Infinity, NaN, '2', undefined]) {
    assert.throws(() => formatResult(value), CalculatorError);
  }
});
