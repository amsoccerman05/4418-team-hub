import type { MealApi } from './types';

export class MealApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code = 'unavailable', status = 503) {
    super(message); this.name = 'MealApiError'; this.code = code; this.status = status;
  }
}

const demo = import.meta.env.VITE_MEALS_DEMO === 'true';
const configured = import.meta.env.VITE_MEALS_API_URL || '';
function endpoint() {
  if (!configured) throw new MealApiError('Meal signups are not open yet. Please check with the meal coordinator.', 'not_configured');
  const url = new URL(configured);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(demo && loopback && url.protocol === 'http:'))) {
    throw new MealApiError('Meal signup configuration needs coordinator review.', 'invalid_configuration');
  }
  if (demo && !loopback) throw new MealApiError('The local preview can use only its local test server.', 'invalid_configuration');
  return url.href;
}

async function request<T>(operation: string, fields: Record<string, unknown> = {}, manager = false, signal?: AbortSignal): Promise<T> {
  const url = endpoint();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (demo) headers['X-Meals-Demo'] = 'true';
  if (manager && !demo) {
    const { supabase } = await import('../attendance/service');
    if (!supabase) throw new MealApiError('Sign in to Team Hub with an active mentor or admin account.', 'unauthorized', 401);
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) throw new MealApiError('Sign in to Team Hub with an active mentor or admin account.', 'unauthorized', 401);
    headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ operation, ...fields }),
      cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new MealApiError('We could not confirm the result. Your request may have reached the server. Refresh before trying again.', 'uncertain_result', 0);
  }
  let malformed = false;
  const data = await response.json().catch(() => { malformed = true; return null; });
  if (malformed || (data === null && response.ok && operation !== 'cancel_claim')) {
    if (!['list', 'manager', 'inspect'].includes(operation)) throw new MealApiError('We could not confirm the result. Refresh before trying again.', 'uncertain_result', 0);
    throw new MealApiError('The meal service returned an unreadable response. Please refresh.', 'unavailable', response.status);
  }
  if (!response.ok) {
    const known = data?.error;
    throw new MealApiError(typeof known?.message === 'string' ? known.message : 'Meal signups are temporarily unavailable. Please try again later.', typeof known?.code === 'string' ? known.code : 'unavailable', response.status);
  }
  return data as T;
}

export const mealApi: MealApi = {
  list: signal => request('list', {}, false, signal),
  claim: input => request('claim', { ...input }),
  verify: token => request('verify', { token }),
  inspect: token => request('inspect', { token }),
  edit: (token, input) => request('edit', { token, ...input }),
  cancel: (token, input) => request('cancel', { token, ...input }),
  manager: signal => request('manager', {}, true, signal),
  saveMeal: input => request('save_meal', { meal: input }, true),
  cancelClaim: input => request('cancel_claim', { ...input }, true),
};
