import { evaluateExpression, formatResult } from './engine.js';

const $ = (selector) => document.querySelector(selector);
const input = $('#expression');
const result = $('#result');
const message = $('#calculation-message');
const display = $('#display');
const live = $('#live-indicator');
const dialog = $('#shortcuts-dialog');
const historyList = $('#history-list');
const storageKeys = { history: 'forma.history.v1', theme: 'forma.theme.v1' };
const MAX_HISTORY = 30;
const MAX_EXPRESSION = 240;
let completed = false;
let currentResult = '0';
let validResult = true;
let toastTimeout;
let history = readHistory();

// Storage may be unavailable in private or restricted browsing contexts.
function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function readHistory() {
  try {
    const data = JSON.parse(readStorage(storageKeys.history) ?? '[]');
    if (!Array.isArray(data)) return [];
    return data
      .filter((item) => {
        if (
          !item ||
          typeof item.expression !== 'string' ||
          typeof item.result !== 'string'
        )
          return false;
        if (item.expression.length > MAX_EXPRESSION || item.result.length > 40)
          return false;
        try {
          return (
            formatResult(evaluateExpression(item.expression)) === item.result
          );
        } catch {
          return false;
        }
      })
      .slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

function showToast(text) {
  clearTimeout(toastTimeout);
  $('#toast').textContent = text;
  $('#toast').classList.add('visible');
  toastTimeout = setTimeout(
    () => $('#toast').classList.remove('visible'),
    2400,
  );
}

function announce(text) {
  $('#announcement').textContent = text;
}

function setResult(text) {
  result.textContent = text;
  result.classList.toggle(
    'result-medium',
    text.length > 10 && text.length <= 15,
  );
  result.classList.toggle('result-small', text.length > 15);
  result.scrollLeft = result.scrollWidth;
}

function updatePreview({ submitted = false } = {}) {
  const expression = input.value.trim();
  display.classList.remove('has-error');
  input.removeAttribute('aria-invalid');
  live.innerHTML = '<span class="status-dot"></span> LIVE';
  if (!expression) {
    currentResult = '0';
    validResult = true;
    setResult('0');
    message.textContent = 'Enter an expression.';
    $('#copy-result').disabled = false;
    return true;
  }
  try {
    currentResult = formatResult(evaluateExpression(expression));
    validResult = true;
    setResult(currentResult);
    message.textContent = submitted
      ? 'Result saved to history.'
      : 'Press Enter to calculate.';
    if (submitted) live.innerHTML = '<span class="status-dot"></span> SOLVED';
    $('#copy-result').disabled = false;
    return true;
  } catch (error) {
    validResult = false;
    setResult('—');
    $('#copy-result').disabled = true;
    const incomplete = [
      'INCOMPLETE_EXPRESSION',
      'UNMATCHED_PARENTHESIS',
      'EMPTY_PARENTHESES',
      'UNEXPECTED_OPERATOR',
    ].includes(error.code);
    message.textContent = error.message;
    live.innerHTML = '<span class="status-dot"></span> EDITING';
    if (submitted || !incomplete) {
      display.classList.add('has-error');
      input.setAttribute('aria-invalid', 'true');
    }
    if (submitted) announce(error.message);
    return false;
  }
}

function focusExpression(position = input.value.length) {
  input.focus({ preventScroll: true });
  input.setSelectionRange(position, position);
}

function insertText(text) {
  if (completed) {
    if (/^[+−\-×*÷/^%]$/.test(text)) {
      input.value = currentResult.startsWith('-')
        ? `(${currentResult})`
        : currentResult;
    } else {
      input.value = '';
    }
    completed = false;
    input.setSelectionRange(input.value.length, input.value.length);
  }
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  if (input.value.length - (end - start) + text.length > MAX_EXPRESSION) {
    showToast('Maximum 240 characters.');
    return;
  }
  input.setRangeText(text, start, end, 'end');
  focusExpression(start + text.length);
  updatePreview();
}

function clearExpression() {
  input.value = '';
  completed = false;
  updatePreview();
  focusExpression();
  announce('Expression cleared.');
}

function backspace() {
  completed = false;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  if (start !== end) input.setRangeText('', start, end, 'end');
  else if (start > 0) input.setRangeText('', start - 1, start, 'end');
  focusExpression(input.selectionStart);
  updatePreview();
}

function toggleSign() {
  const expression = completed ? currentResult : input.value.trim();
  if (!expression) {
    insertText('−');
    return;
  }
  let depth = 0;
  const unwrapped =
    expression.startsWith('−(') &&
    expression.endsWith(')') &&
    [...expression.slice(1)].every((character, index, characters) => {
      if (character === '(') depth++;
      if (character === ')') depth--;
      return depth > 0 || index === characters.length - 1;
    });
  const next = unwrapped ? expression.slice(2, -1) : `−(${expression})`;
  if (next.length > MAX_EXPRESSION) {
    showToast('Maximum 240 characters.');
    return;
  }
  input.value = next;
  completed = false;
  focusExpression();
  updatePreview();
}

function calculate() {
  if (!input.value.trim()) {
    focusExpression();
    return;
  }
  if (!updatePreview({ submitted: true })) {
    focusExpression();
    return;
  }
  const expression = input.value.trim();
  if (!completed || history[0]?.expression !== expression) {
    history.unshift({ expression, result: currentResult });
    history = history.slice(0, MAX_HISTORY);
    if (!writeStorage(storageKeys.history, JSON.stringify(history)))
      showToast('Calculated. History is available for this visit.');
    renderHistory();
  }
  completed = true;
  announce(`${expression} equals ${currentResult}`);
  // Leave native button focus intact for keyboard and assistive technology users.
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Result copied.');
  } catch {
    showToast('Copy unavailable. Select the result to copy it.');
  }
}

function iconUse(id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

function renderHistory() {
  historyList.replaceChildren();
  $('#history-empty').hidden = history.length > 0;
  historyList.hidden = history.length === 0;
  $('#history-count').textContent = history.length;
  $('#clear-history').disabled = history.length === 0;
  history.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'history-item';
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'history-restore';
    restore.title = 'Use this expression again';
    restore.setAttribute(
      'aria-label',
      `Reuse ${item.expression}, result ${item.result}`,
    );
    const expression = document.createElement('span');
    expression.className = 'history-expression';
    expression.textContent = item.expression;
    const value = document.createElement('span');
    value.className = 'history-result';
    value.textContent = item.result;
    restore.append(expression, value);
    restore.addEventListener('click', () => {
      input.value = item.expression;
      completed = false;
      updatePreview();
      focusExpression();
    });
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'icon-button history-copy';
    copy.setAttribute('aria-label', `Copy result ${item.result}`);
    copy.title = 'Copy result';
    copy.append(iconUse('i-copy'));
    copy.addEventListener('click', () => copyText(item.result));
    li.append(restore, copy);
    historyList.append(li);
  });
  $('#history-content').scrollTop = 0;
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const dark = theme === 'dark';
  const label = `Switch to ${dark ? 'light' : 'dark'} theme`;
  $('#theme-toggle').setAttribute('aria-label', label);
  $('#theme-toggle').title = label;
  $('#theme-toggle use').setAttribute('href', dark ? '#i-sun' : '#i-moon');
  $('meta[name="theme-color"]').content = dark ? '#202124' : '#ffffff';
}

function openShortcuts() {
  if (!dialog.open) dialog.showModal();
}

input.addEventListener('input', () => {
  completed = false;
  updatePreview();
});
input.addEventListener('pointerdown', () => {
  completed = false;
});

// Preserve the expression caret when clicking the keypad with a pointer.
$('.keypad').addEventListener('pointerdown', (event) => {
  if (event.target.closest('button') && event.pointerType === 'mouse')
    event.preventDefault();
});
$('.keypad').addEventListener('click', (event) => {
  const key = event.target.closest('button');
  if (!key) return;
  if (key.dataset.insert) insertText(key.dataset.insert);
  else
    ({ clear: clearExpression, sign: toggleSign, backspace, calculate })[
      key.dataset.action
    ]?.();
});

document.addEventListener('keydown', (event) => {
  const onInput = event.target === input;
  if (
    onInput &&
    (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) ||
      ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a'))
  )
    completed = false;
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    dialog.open ||
    event.isComposing
  )
    return;
  if (event.key === '?') {
    event.preventDefault();
    openShortcuts();
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    clearExpression();
    return;
  }
  // Enter and Space activate focused controls using normal browser behavior.
  if (
    !onInput &&
    event.target.closest('button, a') &&
    (event.key === 'Enter' || event.key === ' ')
  )
    return;
  if (event.key === 'Enter' || event.key === '=') {
    event.preventDefault();
    calculate();
    flashKey($('.key-equals'));
    return;
  }
  if (event.key === 'Backspace') {
    if (!onInput) {
      event.preventDefault();
      backspace();
    } else completed = false;
    flashKey($('[data-action="backspace"]'));
    return;
  }
  if (event.key === 'Delete') {
    completed = false;
    return;
  }
  if (/^[\d.+\-*/^()%×÷−eE]$/.test(event.key)) {
    event.preventDefault();
    const symbol = { '*': '×', '/': '÷', '-': '−' }[event.key] ?? event.key;
    if (!onInput)
      input.setSelectionRange(input.value.length, input.value.length);
    insertText(symbol);
    flashKey(
      [...document.querySelectorAll('[data-insert]')].find(
        (key) => key.dataset.insert === symbol,
      ),
    );
  }
});

function flashKey(key) {
  if (!key) return;
  key.classList.add('is-pressed');
  setTimeout(() => key.classList.remove('is-pressed'), 110);
}

$('#copy-result').addEventListener('click', () => {
  if (validResult) copyText(currentResult);
});
$('#clear-history').addEventListener('click', () => {
  history = [];
  const saved = writeStorage(storageKeys.history, '[]');
  renderHistory();
  showToast(
    saved
      ? 'History cleared.'
      : 'History cleared for this visit. Device storage is unavailable.',
  );
});
$('#theme-toggle').addEventListener('click', () => {
  const next =
    document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  writeStorage(storageKeys.theme, next);
});
$('#open-shortcuts').addEventListener('click', openShortcuts);
$('#close-shortcuts').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
  const rect = dialog.getBoundingClientRect();
  if (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  )
    dialog.close();
});

const savedTheme = readStorage(storageKeys.theme);
applyTheme(
  savedTheme === 'dark' || savedTheme === 'light'
    ? savedTheme
    : matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light',
);
renderHistory();
updatePreview();
