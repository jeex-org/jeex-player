/**
 * The URL of the player file that is running, read ONCE while the bundle
 * evaluates.
 *
 * The ES builds keep `import.meta.url`. The IIFE build has no `import.meta`
 * (its config defines the value as `undefined`) but runs synchronously while
 * its own `<script>` is `document.currentScript`, which is why this is read at
 * module evaluation and never later: by the time a lazy feature asks, the
 * current script is gone. Every file a published build loads at run time
 * (its chunks, the Basis transcoder) sits in the same folder as this one, so
 * that folder is where they are looked for. Read by the telemetry's own-file
 * check and by the transcoder location.
 */

/** The own file's URL from what the runtime offers: the module URL, else the current script's `src`, else `''`. */
export function ownFileUrl(moduleUrl: unknown, script: { readonly src?: unknown } | null): string {
  if (typeof moduleUrl === 'string' && moduleUrl !== '') return moduleUrl;
  return script !== null && typeof script.src === 'string' ? script.src : '';
}

/**
 * The document's current script, but only when it IS a script element. A page
 * can shadow `document.currentScript` with any element it names so (an
 * `<img name="currentScript" src="…">` before the player's tag), and the
 * folder read from it decides where the transcoder code is fetched from.
 */
export function currentScriptOf(doc: { readonly currentScript: unknown } | undefined): { readonly src?: unknown } | null {
  const script = doc?.currentScript;
  if (script === null || script === undefined || typeof HTMLScriptElement === 'undefined') return null;
  return script instanceof HTMLScriptElement ? script : null;
}

/** The running player file's URL; `''` where neither source exists. */
export const OWN_FILE_URL: string = ownFileUrl(import.meta.url, currentScriptOf(typeof document === 'undefined' ? undefined : document));
