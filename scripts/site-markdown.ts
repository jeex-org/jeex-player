/**
 * The Markdown twin of a player-site page: the page's `<main>` rendered as
 * Markdown at build time, so an AI agent can read the same content without
 * the markup. Where the twin lives and how the page announces it is
 * `scripts/site-build.ts` (`twinPath`, `writeTwin`); this module only
 * converts.
 *
 * The pages are hand-written and well-formed, so this is a small strict
 * converter for exactly the elements they use, not a general HTML parser: an
 * element, an entity or a mismatched end tag it does not know is an error, so
 * a new construct on a page fails the build instead of vanishing from the
 * twin. What is not content is dropped: `svg`, buttons, scripts, and every
 * element that is `hidden` or `aria-hidden="true"`.
 */

type Element = { tag: string; attrs: Map<string, string>; children: Node[] };
type Node = Element | string;

/** Elements with no end tag. */
const VOID = new Set(['br', 'img', 'meta', 'link', 'hr', 'input', 'source', 'wbr']);
/** Elements dropped with everything inside them. */
const DROPPED = new Set(['svg', 'button', 'script', 'style', 'template', 'noscript', 'head', 'title']);
/** Elements laid out as blocks. */
const BLOCK = new Set([
  'html',
  'body',
  'main',
  'section',
  'article',
  'aside',
  'header',
  'footer',
  'nav',
  'div',
  'figure',
  'figcaption',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'pre',
  'table',
  'details',
  'summary',
  'blockquote',
  'hr',
]);
/** Elements laid out inline. */
const INLINE = new Set(['a', 'code', 'em', 'i', 'b', 'strong', 'span', 'img', 'br', 'small', 'kbd', 'abbr', 'time']);

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  middot: '·',
  laquo: '«',
  raquo: '»',
  copy: '©',
  hellip: '…',
  rarr: '→',
  larr: '←',
  times: '×',
};

function decode(text: string): string {
  return text.replaceAll(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(Number(name.slice(1)));
    const value = ENTITIES[name];
    if (value === undefined) throw new Error(`site-markdown: unknown entity ${whole}`);
    return value;
  });
}

const TOKEN =
  /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>|<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|[^<]+/gy;
const ATTR = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** The document as a tree; a stray `<` or a mismatched end tag is an error. */
function parse(html: string): Element {
  const root: Element = { tag: '#root', attrs: new Map(), children: [] };
  const stack: Element[] = [root];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < html.length) {
    const at = TOKEN.lastIndex;
    const match = TOKEN.exec(html);
    if (match === null) throw new Error(`site-markdown: cannot read the markup at ${JSON.stringify(html.slice(at, at + 40))}`);
    const [whole, endTag, startTag, rawAttrs, selfClosing] = match;
    const top = stack.at(-1) as Element;
    if (whole.startsWith('<!')) continue;
    if (endTag === undefined && startTag === undefined) {
      top.children.push(decode(whole));
    } else if (startTag === undefined) {
      const tag = (endTag as string).toLowerCase();
      if (top.tag !== tag) throw new Error(`site-markdown: </${tag}> closes <${top.tag}>`);
      stack.pop();
    } else {
      const attrs = new Map<string, string>();
      for (const [, name, double, single, bare] of (rawAttrs ?? '').matchAll(ATTR)) {
        attrs.set((name as string).toLowerCase(), decode(double ?? single ?? bare ?? ''));
      }
      const element: Element = { tag: startTag.toLowerCase(), attrs, children: [] };
      top.children.push(element);
      if (!VOID.has(element.tag) && selfClosing !== '/') stack.push(element);
    }
  }
  if (stack.length !== 1) throw new Error(`site-markdown: <${(stack.at(-1) as Element).tag}> is never closed`);
  return root;
}

function find(node: Element, tag: string): Element[] {
  const found: Element[] = [];
  for (const child of node.children) {
    if (typeof child === 'string') continue;
    if (child.tag === tag) found.push(child);
    else found.push(...find(child, tag));
  }
  return found;
}

function skipped(element: Element): boolean {
  return DROPPED.has(element.tag) || element.attrs.has('hidden') || element.attrs.get('aria-hidden') === 'true';
}

function isBlock(node: Node): boolean {
  if (typeof node === 'string') return false;
  if (BLOCK.has(node.tag)) return true;
  if (INLINE.has(node.tag) || DROPPED.has(node.tag)) return false;
  throw new Error(`site-markdown: <${node.tag}> is not an element the twin knows how to write`);
}

function escapeText(text: string): string {
  return text.replaceAll(/[\\`*_[\]<]/g, (char) => `\\${char}`);
}

function codeSpan(text: string): string {
  const fence = text.includes('`') ? '``' : '`';
  return fence === '`' ? `\`${text}\`` : `\`\` ${text} \`\``;
}

/** Every character of text under `node`, as written (for code). */
function rawText(node: Node): string {
  if (typeof node === 'string') return node;
  if (skipped(node)) return '';
  return node.children.map(rawText).join('');
}

class Writer {
  /** The level of the last heading written, so a `<summary>` sits one below it. */
  private level = 1;

  private readonly base: string;

  constructor(base: string) {
    this.base = base;
  }

  private url(href: string): string {
    return new URL(href, this.base).href;
  }

  /**
   * Inline Markdown for `nodes`; blocks met inside (a list item's heading and
   * text) are joined with spaces, and so are two elements with no text between
   * them (`<b>Source</b><span>…</span>`, which the page lays out apart).
   */
  inline(nodes: readonly Node[]): string {
    const parts: string[] = [];
    let afterElement = false;
    for (const node of nodes) {
      if (typeof node === 'string') {
        parts.push(escapeText(node));
        afterElement = false;
        continue;
      }
      if (skipped(node)) continue;
      const written = this.element(node);
      if (written === '') continue;
      parts.push(afterElement ? ` ${written}` : written);
      afterElement = true;
    }
    return parts.join('');
  }

  /** One element inside a line; `''` when it writes nothing. */
  private element(node: Element): string {
    const block = isBlock(node);
    const inner = (): string => this.inline(node.children).replaceAll(/\s+/g, ' ').trim();
    const wrap = (mark: string): string => {
      const text = inner();
      return text === '' ? '' : `${mark}${text}${mark}`;
    };
    switch (node.tag) {
      case 'a': {
        const href = node.attrs.get('href');
        return href === undefined ? inner() : `[${inner()}](${this.url(href)})`;
      }
      case 'code':
      case 'kbd':
        return codeSpan(rawText(node).replaceAll(/\s+/g, ' '));
      case 'em':
      case 'i':
        return wrap('*');
      case 'b':
      case 'strong':
        return wrap('**');
      case 'img':
        return `![${escapeText(node.attrs.get('alt') ?? '')}](${this.url(node.attrs.get('src') ?? '')})`;
      case 'br':
        return ' ';
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
      case 'summary':
        return wrap('**');
      case 'ul':
      case 'ol':
      case 'pre':
      case 'table':
        throw new Error(`site-markdown: <${node.tag}> inside a list item or a paragraph is not supported`);
      default: {
        const text = inner();
        return block && text !== '' ? ` ${text} ` : text;
      }
    }
  }

  private paragraph(nodes: readonly Node[]): string {
    return this.inline(nodes).replaceAll(/\s+/g, ' ').trim();
  }

  /** Markdown blocks for the children of a container: runs of inline nodes become paragraphs. */
  blocks(nodes: readonly Node[]): string[] {
    const out: string[] = [];
    let run: Node[] = [];
    const flush = (): void => {
      const text = this.paragraph(run);
      if (text !== '') out.push(text);
      run = [];
    };
    for (const node of nodes) {
      if (typeof node !== 'string' && skipped(node)) continue;
      if (!isBlock(node)) {
        run.push(node);
        continue;
      }
      flush();
      out.push(...this.block(node as Element));
    }
    flush();
    return out;
  }

  private block(element: Element): string[] {
    const tag = element.tag;
    if (/^h[1-6]$/.test(tag)) {
      this.level = Number(tag[1]);
      return [`${'#'.repeat(this.level)} ${this.paragraph(element.children)}`];
    }
    switch (tag) {
      case 'p':
      case 'figcaption': {
        const text = this.paragraph(element.children);
        return text === '' ? [] : [text];
      }
      case 'summary':
        return [`${'#'.repeat(Math.min(this.level + 1, 6))} ${this.paragraph(element.children)}`];
      case 'ul':
      case 'ol':
        return this.list(element);
      case 'pre': {
        const code = rawText(element).replace(/\n+$/, '');
        const fence = code.includes('```') ? '````' : '```';
        return [`${fence}\n${code}\n${fence}`];
      }
      case 'table':
        return [this.table(element)];
      case 'blockquote':
        return this.blocks(element.children).map((text) => text.replaceAll(/^/gm, '> '));
      case 'hr':
        return ['---'];
      default:
        return this.blocks(element.children);
    }
  }

  /**
   * A list. Items of text, or of a heading and its text, are list items; a
   * list whose items hold code, a table or another list is written as the
   * items' own blocks one after another, since each such item carries its
   * own heading and a code block does not survive being folded into a line.
   */
  private list(element: Element): string[] {
    const items = element.children.filter((child): child is Element => typeof child !== 'string' && !skipped(child));
    for (const item of items) if (item.tag !== 'li') throw new Error(`site-markdown: <${item.tag}> directly inside <${element.tag}>`);
    if (items.some((item) => ['pre', 'table', 'ul', 'ol'].some((tag) => find(item, tag).length > 0))) {
      return items.flatMap((item) => this.blocks(item.children));
    }
    return [items.map((item, index) => `${element.tag === 'ol' ? `${index + 1}.` : '-'} ${this.paragraph(item.children)}`).join('\n')];
  }

  private table(element: Element): string {
    const rows = find(element, 'tr').map((row) =>
      row.children
        .filter((cell): cell is Element => typeof cell !== 'string' && (cell.tag === 'th' || cell.tag === 'td'))
        .map((cell) => this.paragraph(cell.children).replaceAll('|', '\\|')),
    );
    const [head, ...body] = rows;
    if (head === undefined) throw new Error('site-markdown: a <table> without rows');
    const line = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`;
    return [line(head), line(head.map(() => '---')), ...body.map((cells) => line(cells))].join('\n');
  }
}

function render(region: Element, base: string): string {
  return `${new Writer(base).blocks(region.children).join('\n\n')}\n`;
}

/** The Markdown twin of a page: its one `<main>`, with every link made absolute against `base`. */
export function htmlToMarkdown(html: string, base: string): string {
  const mains = find(parse(html), 'main');
  if (mains.length !== 1) throw new Error(`site-markdown: the page has ${mains.length === 0 ? 'no <main>' : 'more than one <main>'}`);
  return render(mains[0] as Element, base);
}

/** Everything a visitor can read on the page (its whole `<body>`), as Markdown: what structured data may claim. */
export function visibleMarkdown(html: string, base: string): string {
  const body = find(parse(html), 'body')[0];
  if (body === undefined) throw new Error('site-markdown: the page has no <body>');
  return render(body, base);
}
