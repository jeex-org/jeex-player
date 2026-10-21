/**
 * The one place a telemetry request is made.
 *
 * Invariant: the request never carries credentials, a referrer or a custom
 * header, never follows a redirect, never touches the HTTP cache, and never
 * fails loudly. The body is a JSON string, so the request is a CORS simple
 * request with no preflight. A missing `fetch`, a synchronous throw (a
 * keepalive body the browser refuses) and a rejected promise all end the
 * same way: nothing happens, nothing is retried and nothing is logged.
 * `navigator.sendBeacon` is not used: it sends with credentials.
 */

/** The exact request options of every send. */
export const TELEMETRY_REQUEST: Readonly<RequestInit> = Object.freeze({
  method: 'POST',
  keepalive: true,
  credentials: 'omit',
  referrerPolicy: 'no-referrer',
  mode: 'cors',
  cache: 'no-store',
  redirect: 'error',
});

/** Posts `body` to `endpoint`, best effort. */
export function sendTelemetry(endpoint: string, body: string): void {
  try {
    const request = globalThis.fetch;
    if (typeof request !== 'function') return;
    void request(endpoint, { ...TELEMETRY_REQUEST, body }).catch(() => undefined);
  } catch {
    // A refused keepalive body or a broken polyfill: telemetry never breaks the player.
  }
}
