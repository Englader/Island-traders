/**
 * localStorage helpers. Storage can be missing or throw (private windows,
 * blocked site data), so every access is guarded and failures are silent.
 */
const PREFIX = 'island-traders:v1:';

export function loadJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}

/** A random id for this browser (online reconnects). */
export function clientId(): string {
  let id = loadJson<string>('clientId');
  if (!id) {
    id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    saveJson('clientId', id);
  }
  return id;
}
