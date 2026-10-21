/**
 * What an error report may say about WHERE an error happened: the top frames
 * of its stack that lie in the player's own files, as bare file names with a
 * line and a column, and the browser family with a bucketed major version.
 *
 * Invariant: nothing of the error's MESSAGE ever leaves this module. The first
 * line of a V8 stack is the message, and a message may carry a URL, a token
 * or a name; `parseStack` reads only the lines that END in `url:line:column`
 * and skips the first line entirely, and a frame keeps its file name only,
 * never its directory, query or fragment. A frame outside the player's files
 * (the site's own code, a browser extension, `eval`) is dropped.
 *
 * The browser bucket is derived here, in the browser, from the client hints
 * or the user-agent string; the string itself is never returned.
 *
 * Pure module: no `three`, no DOM.
 */

/** The most frames one report carries. */
export const MAX_FRAMES = 5;

/** One parsed frame: an absolute script URL without query and fragment, and a 1-based position. */
export type StackFrame = { readonly url: string; readonly line: number; readonly column: number };

/** One reported frame: the file name alone. */
export type OwnFrame = { readonly file: string; readonly line: number; readonly column: number };

/** `scheme://…:line:column` at the END of a frame line, optionally closed by `)`. */
const FRAME = /([a-z][a-z0-9+.-]*:\/\/[^\s()]*?|blob:[^\s()]*?):(\d+):(\d+)\)?\s*$/i;

/** The URL without its query and fragment. */
function bare(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/**
 * Every frame of `stack` whose line ends in an absolute URL with a position.
 *
 * V8 writes the message as the stack's first line; Firefox and Safari write no
 * message at all. Skipping the first line only when it is not itself a frame
 * line keeps the frame the latter two put there.
 */
export function parseStack(stack: unknown): StackFrame[] {
  if (typeof stack !== 'string' || stack === '') return [];
  const lines = stack.split('\n');
  const frames: StackFrame[] = [];
  lines.forEach((line, index) => {
    const isFrameLine = /^\s+at\s|@/.test(line) && !/^\w*Error\b|^\w+:\s/.test(line);
    if (index === 0 && !isFrameLine) return;
    const match = FRAME.exec(line);
    if (!match) return;
    // `eval at run (url:5:6), <anonymous>:1:1` ends in `<anonymous>`: not ours, not a file.
    if (/\beval at\b/.test(line)) return;
    frames.push({ url: bare(match[1]!), line: Number(match[2]), column: Number(match[3]) });
  });
  return frames;
}

/** The top `MAX_FRAMES` frames `isOwn` accepts, reduced to their file names. */
export function ownFrames(frames: readonly StackFrame[], isOwn: (url: string) => boolean): OwnFrame[] {
  return frames
    .filter((frame) => isOwn(frame.url))
    .slice(0, MAX_FRAMES)
    .map((frame) => ({ file: frame.url.slice(frame.url.lastIndexOf('/') + 1), line: frame.line, column: frame.column }));
}

/** The part of `navigator.userAgentData` this module reads. */
export type ClientHints = { readonly brands?: ReadonlyArray<{ readonly brand: string; readonly version: string }> };

/** `chromium-13x` for 130–139, and so on: the tens of the major version. */
function tens(family: string, major: number): string {
  return `${family}-${Math.floor(major / 10)}x`;
}

/** Family and bucketed major version: `chromium-13x`, `firefox-14x`, `safari-26`, or `other`. */
export function browserBucket(hints: ClientHints | undefined, userAgent: string): string {
  const chromium = hints?.brands?.find((entry) => entry.brand === 'Chromium');
  if (chromium) {
    const major = Math.trunc(Number(chromium.version.split('.')[0]));
    return Number.isFinite(major) ? tens('chromium', major) : 'other';
  }
  const firefox = /\bFirefox\/(\d+)/.exec(userAgent);
  if (firefox) return tens('firefox', Number(firefox[1]));
  const chrome = /\b(?:Chrome|Chromium|CriOS)\/(\d+)/.exec(userAgent);
  if (chrome) return tens('chromium', Number(chrome[1]));
  const safari = /\bVersion\/(\d+)[\d.]*.*\bSafari\//.exec(userAgent);
  if (safari) return `safari-${Number(safari[1])}`;
  return 'other';
}
