import { z } from 'zod';

export class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
export const fail = (status, message, code) => { throw new HttpError(status, message, code); };

/** Строгая валидация: неизвестные поля отклоняются (защита от mass assignment). */
export function parse(schema, data) {
  const r = schema.strict().safeParse(data ?? {});
  if (!r.success) {
    const issue = r.error.issues[0];
    fail(400, `${issue.path.join('.') || 'body'}: ${issue.message}`, 'validation_error');
  }
  return r.data;
}

export const clientIp = (req) => req.ip || req.socket?.remoteAddress || null;

// Общие схемы
export const zText = (max) => z.string().trim().max(max);
export const zMoney = z.number().int().positive();
export { z };
