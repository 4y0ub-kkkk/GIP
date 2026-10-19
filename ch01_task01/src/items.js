import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from './auth.js';
import { HttpError } from './errors.js';
import { dateValue, enumValue, invalid, itemId, text, validateObject } from './validation.js';

const fields = ['type', 'title', 'description', 'category', 'location', 'eventDate'];
const columns = { type: 'type', title: 'title', description: 'description', category: 'category', location: 'location', eventDate: 'event_date' };

function validateReport(body, partial = false) {
  validateObject(body, fields, partial ? [] : fields);
  if (Object.keys(body).length === 0) invalid('body', 'Include at least one report field.');
  const values = {};
  for (const field of Object.keys(body)) {
    switch (field) {
      case 'type': values[field] = enumValue(body[field], field, ['lost', 'found']); break;
      case 'title': values[field] = text(body[field], field, { min: 3, max: 120 }); break;
      case 'description': values[field] = text(body[field], field, { min: 10, max: 2000 }); break;
      case 'category': values[field] = text(body[field], field, { max: 50 }); break;
      case 'location': values[field] = text(body[field], field, { max: 120 }); break;
      case 'eventDate': values[field] = dateValue(body[field], field); break;
    }
  }
  return values;
}

function serialize(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    type: row.type,
    title: row.title,
    description: row.description,
    category: row.category,
    location: row.location,
    eventDate: row.event_date,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    recoveredAt: row.recovered_at,
  };
}

function findItem(database, id) {
  const row = database.prepare('SELECT * FROM items WHERE id = ?').get(itemId(id));
  if (!row) throw new HttpError(404, 'ITEM_NOT_FOUND', 'Item report not found.');
  return row;
}

function ownedItem(database, request) {
  const row = findItem(database, request.params.id);
  if (row.owner_id !== request.user.id) {
    throw new HttpError(403, 'FORBIDDEN', 'Only the report owner can change this item.');
  }
  return row;
}

function positiveInteger(value, field, fallback, max) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    invalid(field, 'Use a positive whole number.');
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > max) invalid(field, `Must not exceed ${max}.`);
  return number;
}

function parseQuery(query) {
  const allowed = ['q', 'type', 'category', 'location', 'status', 'from', 'to', 'page', 'limit', 'mine'];
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.includes(key)) invalid(key, 'This query parameter is not supported.');
    if (typeof value !== 'string') invalid(key, 'Use this query parameter only once.');
  }
  const options = {
    page: positiveInteger(query.page, 'page', 1, 1_000_000),
    limit: positiveInteger(query.limit, 'limit', 20, 100),
    mine: query.mine === 'true',
  };
  if (query.mine !== undefined) enumValue(query.mine, 'mine', ['true', 'false']);
  for (const [key, max] of [['q', 200], ['category', 50], ['location', 120]]) {
    if (query[key] !== undefined) options[key] = text(query[key], key, { max });
  }
  if (query.type !== undefined) options.type = enumValue(query.type, 'type', ['lost', 'found']);
  if (query.status !== undefined) options.status = enumValue(query.status, 'status', ['open', 'recovered']);
  if (query.from !== undefined) options.from = dateValue(query.from, 'from');
  if (query.to !== undefined) options.to = dateValue(query.to, 'to');
  if (options.from && options.to && options.from > options.to) invalid('from', 'Must be on or before to.');
  return options;
}

// Escape LIKE metacharacters so user text is always a literal substring.
function contains(value) {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

export function createItemsRouter(database) {
  const router = Router();
  const authenticated = requireAuth(database);

  router.get('/', (request, response, next) => {
    const options = parseQuery(request.query);
    const list = () => {
      const conditions = [];
      const parameters = [];
      for (const field of ['type', 'status']) {
        if (options[field]) {
          conditions.push(`${field} = ?`);
          parameters.push(options[field]);
        }
      }
      for (const field of ['category', 'location']) {
        if (options[field]) {
          conditions.push(`${field} LIKE ? ESCAPE '\\'`);
          parameters.push(contains(options[field]));
        }
      }
      if (options.q) {
        conditions.push("(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\' OR location LIKE ? ESCAPE '\\')");
        parameters.push(...Array(4).fill(contains(options.q)));
      }
      if (options.from) { conditions.push('event_date >= ?'); parameters.push(options.from); }
      if (options.to) { conditions.push('event_date <= ?'); parameters.push(options.to); }
      if (options.mine) { conditions.push('owner_id = ?'); parameters.push(request.user.id); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { total } = database.prepare(`SELECT COUNT(*) AS total FROM items ${where}`).get(...parameters);
      const items = database.prepare(`SELECT * FROM items ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
        .all(...parameters, options.limit, (options.page - 1) * options.limit).map(serialize);
      response.json({ items, pagination: { page: options.page, limit: options.limit, total, totalPages: Math.ceil(total / options.limit) } });
    };
    if (options.mine) return authenticated(request, response, (error) => error ? next(error) : list());
    list();
  });

  router.get('/:id', (request, response) => {
    response.json({ item: serialize(findItem(database, request.params.id)) });
  });

  router.post('/', authenticated, (request, response) => {
    const values = validateReport(request.body);
    const id = randomUUID();
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO items (id, owner_id, type, title, description, category, location, event_date, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`).run(id, request.user.id, values.type, values.title, values.description, values.category, values.location, values.eventDate, now, now);
    response.location(`/api/v1/items/${id}`).status(201).json({ item: serialize(findItem(database, id)) });
  });

  router.patch('/:id', authenticated, (request, response) => {
    const row = ownedItem(database, request);
    if (row.status === 'recovered') throw new HttpError(409, 'ITEM_RECOVERED', 'Recovered reports cannot be edited.');
    const values = validateReport(request.body, true);
    const names = Object.keys(values);
    // Column names come only from the fixed allowlist above, never raw input.
    const assignments = names.map((field) => `${columns[field]} = ?`).join(', ');
    database.prepare(`UPDATE items SET ${assignments}, updated_at = ? WHERE id = ?`)
      .run(...names.map((field) => values[field]), new Date().toISOString(), row.id);
    response.json({ item: serialize(findItem(database, row.id)) });
  });

  router.patch('/:id/recover', authenticated, (request, response) => {
    const row = ownedItem(database, request);
    validateObject(request.body === undefined ? {} : request.body, []);
    if (row.status !== 'recovered') {
      const now = new Date().toISOString();
      database.prepare("UPDATE items SET status = 'recovered', recovered_at = ?, updated_at = ? WHERE id = ?").run(now, now, row.id);
    }
    response.json({ item: serialize(findItem(database, row.id)) });
  });

  return router;
}
