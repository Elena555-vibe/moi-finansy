export type CloudSession = { apiUrl: string; email: string; token: string; lastSyncedAt?: string; dirty?: boolean };

declare global {
  interface Window { __MOI_FINANSY_CONFIG__?: { apiUrl?: string } }
}

const configuredUrl = () => (window.__MOI_FINANSY_CONFIG__?.apiUrl || '').replace(/\/$/, '');
const request = async <T>(apiUrl: string, path: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Не удалось связаться с сервером.');
  return body as T;
};

export const serverConfigured = () => Boolean(configuredUrl());
export const createAccount = async (email: string, password: string) => {
  const apiUrl = configuredUrl();
  const result = await request<{ token: string; email: string }>(apiUrl, '/register', { method: 'POST', body: JSON.stringify({ email, password }) });
  return { apiUrl, email: result.email, token: result.token } satisfies CloudSession;
};
export const signIn = async (email: string, password: string) => {
  const apiUrl = configuredUrl();
  const result = await request<{ token: string; email: string }>(apiUrl, '/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  return { apiUrl, email: result.email, token: result.token } satisfies CloudSession;
};
export const pushState = async <T>(session: CloudSession, state: T) => request<{ version: number }>(session.apiUrl, '/state', {
  method: 'PUT', headers: { Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ state }),
});
export const pullState = async <T>(session: CloudSession) => request<{ state: T | null; updatedAt?: string }>(session.apiUrl, '/state', {
  headers: { Authorization: `Bearer ${session.token}` },
});
