import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SITE_ORIGIN, pageUrl, twinPath } from './site-build.ts';
import { htmlToMarkdown, visibleMarkdown } from './site-markdown.ts';

const SITE = join(import.meta.dirname, '..', 'site');
const PAGE = 'https://player.jeex.org/guide.html';

/** A page whose `<main>` holds `body`, with a header and footer that must stay out of the twin. */
function page(body: string): string {
  return `<!DOCTYPE html><html><head><title>t</title></head><body><header><a href="#top">Brand</a></header><main id="main">${body}</main><footer><p>Footer text</p></footer></body></html>`;
}

describe('twinPath and pageUrl', () => {
  test('a page and its Markdown twin sit side by side; a directory page keeps index', () => {
    expect(twinPath('index.html')).toBe('index.md');
    expect(twinPath('integration.html')).toBe('integration.md');
    expect(twinPath('about/index.html')).toBe('about/index.md');
  });

  test('the URL a page is served at: a directory page is its directory', () => {
    expect(pageUrl('index.html')).toBe(`${SITE_ORIGIN}/`);
    expect(pageUrl('about/index.html')).toBe(`${SITE_ORIGIN}/about/`);
    expect(pageUrl('telemetry.html')).toBe(`${SITE_ORIGIN}/telemetry.html`);
  });
});

describe('htmlToMarkdown', () => {
  test('takes only <main>: headings, paragraphs and inline marks', () => {
    const md = htmlToMarkdown(
      page(
        '<section><h1>Title <em>here</em>.</h1><p class="lede">One &mdash; <b>two</b>, <code>three()</code>.</p><h2>Next</h2><p>Text</p></section>',
      ),
      PAGE,
    );
    expect(md).toBe('# Title *here*.\n\nOne — **two**, `three()`.\n\n## Next\n\nText\n');
  });

  test('links resolve against the page, anchors included; a link without href is its text', () => {
    const md = htmlToMarkdown(
      page(
        '<p><a href="install.md">install</a>, <a href="#faq">FAQ</a>, <a href="https://example.org/x">x</a>, <a aria-disabled="true">Soon</a></p>',
      ),
      PAGE,
    );
    expect(md).toBe(
      '[install](https://player.jeex.org/install.md), [FAQ](https://player.jeex.org/guide.html#faq), [x](https://example.org/x), Soon\n',
    );
  });

  test('drops what is not content: svg, buttons, hidden and aria-hidden elements, empty paragraphs', () => {
    const md = htmlToMarkdown(
      page(
        '<div><svg viewBox="0 0 1 1"><path d="M0 0"/></svg><button type="button">Copy</button><span aria-hidden="true">2D</span><p hidden>gone</p><p role="status"></p><p>kept</p></div>',
      ),
      PAGE,
    );
    expect(md).toBe('kept\n');
  });

  test('two elements laid out apart with nothing between them stay apart in the text', () => {
    const md = htmlToMarkdown(page('<ul><li><a href="https://example.org/"><b>Source</b><span>example.org</span></a></li></ul>'), PAGE);
    expect(md).toBe('- [**Source** example.org](https://example.org/)\n');
  });

  test('inline runs inside a container become one paragraph, blocks stay blocks', () => {
    const md = htmlToMarkdown(page('<div class="cta-row"><a href="a.html">A</a> <a href="b.html">B</a></div><p>After</p>'), PAGE);
    expect(md).toBe('[A](https://player.jeex.org/a.html) [B](https://player.jeex.org/b.html)\n\nAfter\n');
  });

  test('lists: plain items, and items holding blocks flattened with their heading in bold', () => {
    const md = htmlToMarkdown(
      page(
        '<ul><li>One <span>&mdash; detail</span></li><li><h3>Walk</h3><p>A person at eye height.</p></li></ul><ol><li>First</li><li>Second</li></ol>',
      ),
      PAGE,
    );
    expect(md).toBe('- One — detail\n- **Walk** A person at eye height.\n\n1. First\n2. Second\n');
  });

  test('a list whose items hold code is written as the items, one after another', () => {
    const md = htmlToMarkdown(
      page('<ol><li><h3>Element</h3><p>Plain HTML.</p><pre>&lt;x&gt;</pre></li><li><h3>iframe</h3><pre>y</pre></li></ol>'),
      PAGE,
    );
    expect(md).toBe('### Element\n\nPlain HTML.\n\n```\n<x>\n```\n\n### iframe\n\n```\ny\n```\n');
  });

  test('code blocks keep their text and drop the highlighting markup', () => {
    const md = htmlToMarkdown(
      page(
        '<pre class="code"><span class="t">&lt;script</span> <span class="a">src</span>=<span class="s">"x.js"</span><span class="t">&gt;&lt;/script&gt;</span>\nbun run build</pre>',
      ),
      PAGE,
    );
    expect(md).toBe('```\n<script src="x.js"></script>\nbun run build\n```\n');
  });

  test('a FAQ entry: the summary is a heading one level below the last one', () => {
    const md = htmlToMarkdown(
      page('<h2>FAQ</h2><details name="faq" open><summary>Is it free?</summary><div><p>Yes.</p></div></details>'),
      PAGE,
    );
    expect(md).toBe('## FAQ\n\n### Is it free?\n\nYes.\n');
  });

  test('tables become pipe tables, with pipes in cells escaped', () => {
    const md = htmlToMarkdown(
      page(
        '<table><thead><tr><th>Field</th><th>Meaning</th></tr></thead><tbody><tr><td><code>a</code></td><td>x | y</td></tr></tbody></table>',
      ),
      PAGE,
    );
    expect(md).toBe('| Field | Meaning |\n| --- | --- |\n| `a` | x \\| y |\n');
  });

  test('an image is its alt text and absolute source', () => {
    const md = htmlToMarkdown(page('<figure><img src="assets/p.webp" alt="The flat"><figcaption>Caption</figcaption></figure>'), PAGE);
    expect(md).toBe('![The flat](https://player.jeex.org/assets/p.webp)\n\nCaption\n');
  });

  test('text that Markdown would read as markup is escaped; code is not', () => {
    const md = htmlToMarkdown(page('<p>a_b *c* [d] &lt;e&gt; <code>f_g</code></p>'), PAGE);
    expect(md).toBe('a\\_b \\*c\\* \\[d\\] \\<e> `f_g`\n');
  });

  test('refuses what it cannot render faithfully', () => {
    expect(() => htmlToMarkdown('<html><body><p>x</p></body></html>', PAGE)).toThrow(/no <main>/);
    expect(() => htmlToMarkdown(page('<video src="x"></video>'), PAGE)).toThrow(/<video>/);
    expect(() => htmlToMarkdown(page('<p>&bogus;</p>'), PAGE)).toThrow(/&bogus;/);
    expect(() => htmlToMarkdown(page('<p><b>x</p>'), PAGE)).toThrow(/<\/p>/);
  });
});

describe('the real site pages', () => {
  const pages = readdirSync(SITE).filter((name) => name.endsWith('.html'));

  test.each(pages)('%s converts, with one <h1> before every other heading and only absolute links', (name) => {
    const md = htmlToMarkdown(readFileSync(join(SITE, name), 'utf8'), pageUrl(name));
    const headings = md.match(/^#+ /gm) ?? [];
    expect(headings[0]).toBe('# ');
    expect(headings.filter((heading) => heading === '# ').length).toBe(1);
    for (const [, target] of md.matchAll(/\]\(([^)\s]+)\)/g)) expect(target).toMatch(/^https:\/\//);
  });

  test('the JSON-LD of the home page says only what the page shows', () => {
    const html = readFileSync(join(SITE, 'index.html'), 'utf8');
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    expect(blocks.length).toBe(1);
    const data = JSON.parse(blocks[0]?.[1] ?? '') as { '@graph': Record<string, string>[] };
    expect(data['@graph'].map((node) => node['@type'])).toEqual(['WebSite', 'SoftwareSourceCode']);
    const visible = visibleMarkdown(html, pageUrl('index.html'));
    for (const node of data['@graph']) {
      for (const [key, value] of Object.entries(node)) {
        if (key.startsWith('@')) continue;
        expect(visible).toContain(value);
      }
    }
  });

  test('robots.txt lets the OpenAI crawlers in and signals search, AI input and training', () => {
    const robots = readFileSync(join(SITE, 'robots.txt'), 'utf8');
    for (const agent of ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User']) {
      expect(robots).toMatch(new RegExp(`User-agent: ${agent}\\nAllow: /\\n`));
    }
    expect(robots).toMatch(/User-agent: \*\nContent-Signal: search=yes, ai-input=yes, ai-train=yes\nAllow: \/\n/);
    expect(robots).not.toMatch(/Disallow/);
  });

  test("llms.txt links the site's pages through their Markdown twins", () => {
    const llms = readFileSync(join(SITE, 'llms.txt'), 'utf8');
    const ours = [...llms.matchAll(/\]\((https:\/\/player\.jeex\.org\/[^)]*)\)/g)].map((match) => match[1] ?? '');
    expect(ours.length).toBeGreaterThan(0);
    const twins = new Set(pages.map((name) => twinPath(name)));
    for (const url of ours) {
      const path = url.slice(`${SITE_ORIGIN}/`.length);
      expect(path.endsWith('.html')).toBe(false);
      expect(path === 'install.md' || twins.has(path)).toBe(true);
    }
    expect(ours).toContain(`${SITE_ORIGIN}/index.md`);
  });
});
