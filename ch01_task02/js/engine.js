/**
 * A small, safe expression parser. No JavaScript source is executed.
 *
 * Precedence, highest first: parentheses, postfix %, ^, unary +/-, *, /,
 * then + and -. Powers associate to the right. A percentage always means
 * division by 100: 200 + 10% is 200.1, not 220.
 */

const MAX_INPUT_LENGTH = 512;
const MAX_TOKENS = 256;
const MAX_NESTING = 64;
const NUMBER_PATTERN = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;

export class CalculatorError extends Error {
  constructor(message, code = 'INVALID_EXPRESSION') {
    super(message);
    this.name = 'CalculatorError';
    this.code = code;
  }
}

function fail(message, code) {
  throw new CalculatorError(message, code);
}

function requireFinite(value) {
  if (Number.isNaN(value)) {
    fail('This expression has no real result.', 'INVALID_RESULT');
  }
  if (!Number.isFinite(value)) {
    fail('This result is too large.', 'OUT_OF_RANGE');
  }
  return Object.is(value, -0) ? 0 : value;
}

function tokenize(expression) {
  if (typeof expression !== 'string') {
    fail(
      'Enter an expression using numbers and operators.',
      'INVALID_EXPRESSION',
    );
  }
  if (expression.length > MAX_INPUT_LENGTH) {
    fail(`Use no more than ${MAX_INPUT_LENGTH} characters.`, 'INPUT_TOO_LONG');
  }

  const source = expression
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-');
  const tokens = [];
  let index = 0;

  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    if (/[\d.]/.test(character)) {
      const match = NUMBER_PATTERN.exec(source.slice(index));
      if (!match) {
        fail('Add a digit beside the decimal point.', 'INVALID_NUMBER');
      }
      const value = Number(match[0]);
      if (!Number.isFinite(value)) {
        fail('That number is too large.', 'OUT_OF_RANGE');
      }
      index += match[0].length;
      if (source[index] === 'e' || source[index] === 'E') {
        fail('Complete the scientific notation.', 'INCOMPLETE_EXPRESSION');
      }
      tokens.push({ type: 'number', value });
    } else if ('+-*/^()%'.includes(character)) {
      tokens.push({ type: character });
      index += 1;
    } else {
      fail('Use numbers and supported operators only.', 'INVALID_CHARACTER');
    }

    if (tokens.length > MAX_TOKENS) {
      fail('This expression is too complex.', 'TOO_COMPLEX');
    }
  }

  if (tokens.length === 0) {
    fail('Enter an expression to calculate.', 'EMPTY_EXPRESSION');
  }
  tokens.push({ type: 'end' });
  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.position = 0;
    this.nesting = 0;
  }

  peek() {
    return this.tokens[this.position].type;
  }

  take(type) {
    if (this.peek() !== type) return false;
    this.position += 1;
    return true;
  }

  parse() {
    const result = this.addition();
    if (this.peek() === ')') {
      fail('This closing parenthesis has no match.', 'UNMATCHED_PARENTHESIS');
    }
    if (this.peek() !== 'end') {
      fail('Use an operator between numbers.', 'MISSING_OPERATOR');
    }
    return requireFinite(result);
  }

  addition() {
    let value = this.multiplication();
    while (this.peek() === '+' || this.peek() === '-') {
      const operator = this.tokens[this.position++].type;
      const right = this.multiplication();
      value = requireFinite(operator === '+' ? value + right : value - right);
    }
    return value;
  }

  multiplication() {
    let value = this.unary();
    while (true) {
      if (this.take('*')) {
        value = requireFinite(value * this.unary());
      } else if (this.take('/')) {
        const right = this.unary();
        if (right === 0) {
          fail('Cannot divide by zero.', 'DIVISION_BY_ZERO');
        }
        value = requireFinite(value / right);
      } else if (
        this.peek() === '(' ||
        (this.peek() === 'number' &&
          this.tokens[this.position - 1]?.type === ')')
      ) {
        // Juxtaposition, such as 2(3 + 4), has the same precedence as *.
        value = requireFinite(value * this.unary());
      } else {
        break;
      }
    }
    return value;
  }

  unary() {
    this.nesting += 1;
    if (this.nesting > MAX_NESTING) {
      fail('This expression is too deeply nested.', 'TOO_COMPLEX');
    }
    try {
      if (this.take('+')) return this.unary();
      if (this.take('-')) return requireFinite(-this.unary());
      return this.power();
    } finally {
      this.nesting -= 1;
    }
  }

  power() {
    const value = this.percentage();
    // Recursing through unary preserves both 2^-2 and -2^2 conventions.
    return this.take('^') ? requireFinite(value ** this.unary()) : value;
  }

  percentage() {
    let value = this.primary();
    while (this.take('%')) value /= 100;
    return value;
  }

  primary() {
    if (this.peek() === 'number') {
      return this.tokens[this.position++].value;
    }
    if (this.take('(')) {
      if (this.peek() === ')') {
        fail('Parentheses need an expression.', 'EMPTY_PARENTHESES');
      }
      const value = this.addition();
      if (!this.take(')')) {
        if (this.peek() !== 'end') {
          fail('Use an operator between numbers.', 'MISSING_OPERATOR');
        }
        fail('Close the open parenthesis.', 'UNMATCHED_PARENTHESIS');
      }
      return value;
    }
    if (this.peek() === 'end') {
      fail('Complete the expression.', 'INCOMPLETE_EXPRESSION');
    }
    if (this.peek() === ')') {
      fail(
        'Add a number before the closing parenthesis.',
        'UNEXPECTED_PARENTHESIS',
      );
    }
    fail('Add a number before this operator.', 'UNEXPECTED_OPERATOR');
  }
}

/** Evaluate a supported arithmetic expression and return a finite number. */
export function evaluateExpression(expression) {
  return new Parser(tokenize(expression)).parse();
}

/**
 * Round display values to 12 significant digits, removing common floating point
 * artifacts without rounding tiny values down to zero. Output can be evaluated
 * again, including its scientific notation.
 */
export function formatResult(value) {
  if (typeof value !== 'number') {
    fail('The result must be a number.', 'INVALID_RESULT');
  }
  const finiteValue = requireFinite(value);
  const rounded = Number(finiteValue.toPrecision(12));
  // Rounding Number.MAX_VALUE upward would turn a valid result into Infinity.
  return String(Number.isFinite(rounded) ? rounded : finiteValue);
}
