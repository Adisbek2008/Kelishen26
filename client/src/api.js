// Обёртка над fetch: cookie-сессия + CSRF-токен + обязательный X-Requested-With + Idempotency-Key для денежных операций
let csrf = '';
export const setCsrf = (t) => { csrf = t || ''; };

function newKey() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export async function api(path, { method = 'GET', body, headers = {}, idempotent = false } = {}) {
  const h = { 'X-Requested-With': 'SafeDeal', ...headers };
  if (csrf) h['X-CSRF-Token'] = csrf;
  let payload = body;
  if (body instanceof Blob) h['Content-Type'] = 'application/octet-stream';
  else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  if (idempotent) h['Idempotency-Key'] = typeof idempotent === 'string' ? idempotent : newKey();
  const res = await fetch('/api' + path, { method, headers: h, body: payload, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || 'Ошибка сети');
    e.status = res.status; e.code = data.code;
    if (res.status === 401 && path !== '/auth/login') window.dispatchEvent(new Event('sd:unauth'));
    throw e;
  }
  if (data.csrfToken) csrf = data.csrfToken;
  return data;
}

export const uploadFile = (file, purpose, dealId) => {
  if (file.size > 10 * 1024 * 1024) return Promise.reject(new Error('Файл больше 10 МБ'));
  return api('/files', { method: 'POST', body: file, headers: { 'X-Purpose': purpose, 'X-File-Name': encodeURIComponent(file.name), ...(dealId && { 'X-Deal-Id': dealId }) } });
};

/** Копирование в буфер: Clipboard API работает только в защищённом контексте (HTTPS/localhost),
 *  поэтому при открытии по http://IP с телефона используем запасной вариант через execCommand. */
export async function copyText(text) {
  if (window.isSecureContext && navigator.clipboard) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* попробуем запасной способ */ }
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

export const money = (cents) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents || 0) / 100);
export const fmtDate = (iso) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtTime = (iso) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
export const fmtDateTime = (iso) => `${fmtDate(iso)}, ${fmtTime(iso)}`;
export const fmtSize = (b) => (b > 1024 * 1024 ? (b / 1048576).toFixed(1) + ' МБ' : Math.ceil(b / 1024) + ' КБ');
