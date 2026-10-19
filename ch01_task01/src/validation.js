import { HttpError } from './errors.js';

export function invalid(field, message) {
  throw new HttpError(400, 'VALIDATION_ERROR', 'Check the request fields.', [{ field, message }]);
}

export function validateObject(body, allowed, required = []) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    invalid('body', 'Send a JSON object.');
  }
  for (const field of Object.keys(body)) {
    if (!allowed.includes(field)) invalid(field, 'This field is not allowed.');
  }
  for (const field of required) {
    if (!Object.hasOwn(body, field)) invalid(field, 'This field is required.');
  }
  return body;
}

export function text(value, field, { min = 1, max } = {}) {
  if (typeof value !== 'string') invalid(field, 'Must be a string.');
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    invalid(field, `Use between ${min} and ${max} characters.`);
  }
  return trimmed;
}

export function enumValue(value, field, allowed) {
  if (!allowed.includes(value)) invalid(field, `Use one of: ${allowed.join(', ')}.`);
  return value;
}

export function dateValue(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    invalid(field, 'Use a date in YYYY-MM-DD format.');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    invalid(field, 'Use a valid calendar date.');
  }
  if (value > new Date().toISOString().slice(0, 10)) {
    invalid(field, 'The date cannot be in the future (UTC).');
  }
  return value;
}

export function itemId(value) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    invalid('id', 'Use a valid UUID.');
  }
  return value.toLowerCase();
}
