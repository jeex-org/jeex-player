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

/** The running player file's URL; `''` where neither source exists. */
export const OWN_FILE_URL: string = ownFileUrl(
  import.meta.url,
  typeof document === 'undefined' ? null : (document.currentScript as { readonly src?: unknown } | null),
);
