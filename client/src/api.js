// fetch wrapper: cookie session + CSRF token + required X-Requested-With + Idempotency-Key for money operations
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
    const e = new Error(data.error || 'Network error');
    e.status = res.status; e.code = data.code;
    if (res.status === 401 && path !== '/auth/login') window.dispatchEvent(new Event('sd:unauth'));
    throw e;
  }
  if (data.csrfToken) csrf = data.csrfToken;
  return data;
}

export const uploadFile = (file, purpose, dealId) => {
  if (file.size > 10 * 1024 * 1024) return Promise.reject(new Error('File is larger than 10 MB'));
  return api('/files', { method: 'POST', body: file, headers: { 'X-Purpose': purpose, 'X-File-Name': encodeURIComponent(file.name), ...(dealId && { 'X-Deal-Id': dealId }) } });
};

/** Copy to clipboard: the Clipboard API only works in a secure context (HTTPS/localhost),
 *  so over plain http://IP from a phone we fall back to execCommand. */
export async function copyText(text) {
  if (window.isSecureContext && navigator.clipboard) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* try the fallback */ }
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
export const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
export const fmtDateTime = (iso) => `${fmtDate(iso)}, ${fmtTime(iso)}`;
export const fmtSize = (b) => (b > 1024 * 1024 ? (b / 1048576).toFixed(1) + ' MB' : Math.ceil(b / 1024) + ' KB');
