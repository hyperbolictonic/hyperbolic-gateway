import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';

const root = process.cwd();
const out = path.join(root, '_site');
const repoUrl = 'https://github.com/hyperbolictonic/hyperbolic-gateway';
const pagesRoot = 'https://hyperbolictonic.github.io/hyperbolic-gateway';

const pageDocs = [
  'README.md',
  'CHANGELOG.md',
  'docs/README.md',
  'docs/BUILDING.md',
  'docs/CODEBASE.md',
  'docs/CONTROL_LAYER.md',
  'docs/DECISION_MODELS.md',
  'docs/EMBEDDING_PROVIDERS.md',
  'docs/HYPERBOLIC_REST.md',
  'docs/KUANG_WRAP.md',
  'docs/PACKAGING.md',
  'docs/RESEARCH_STEALTH.md',
  'docs/SHADOW_DOM_AND_FRAMES.md',
  'docs/SHADOW_WALK.md',
  'docs/concept.md',
  'kuang_docs/partitions/browser_navigation_playbook.md',
  'kuang_docs/partitions/captcha_and_anti_bot_strategies.md',
  'kuang_docs/partitions/primitives_and_workflows.md',
  'kuang_docs/partitions/selector_and_som_recipes.md',
];
const files = pageDocs.map((file) => path.join(root, file)).filter((file) => fs.existsSync(file));

function titleOf(markdown, fallback) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].replace(/[*_`]/g, '').trim() : fallback;
}

function outputFor(file) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  if (rel === 'docs/README.md') return 'docs/index.html';
  return rel.replace(/\.md$/, '.html');
}

function prefixFor(output) {
  return '../'.repeat(output.split('/').length - 1);
}

const pageInfo = new Map();
for (const file of files) {
  const markdown = fs.readFileSync(file, 'utf8');
  const output = outputFor(file);
  pageInfo.set(output, {
    file,
    output,
    title: titleOf(markdown, path.basename(file, '.md')),
    markdown,
  });
}

function rewriteLinks(html, page) {
  const sourceDir = path.dirname(page.file);
  return html.replace(/href="(?!https?:|mailto:|#)([^"]+)"/g, (match, href) => {
    const [pathname, hash = ''] = String(href).split('#');
    const targetFile = path.resolve(sourceDir, pathname);
    const targetOutput = outputFor(targetFile);
    if (pathname.endsWith('.md')) {
      if (!pageInfo.has(targetOutput)) {
        const rel = path.relative(root, targetFile).split(path.sep).join('/');
        return `href="${repoUrl}/blob/main/${rel}${hash ? `#${hash}` : ''}"`;
      }
      const relative = path.posix.relative(path.posix.dirname(page.output), targetOutput);
      return `href="${relative}${hash ? `#${hash}` : ''}"`;
    }
    const siteCandidate = path.resolve(out, pathname.replace(/^\//, ''));
    if (siteCandidate.startsWith(out + path.sep) && fs.existsSync(siteCandidate)) return match;
    if (/(\.json|\.mjs|\.cjs|\.js|\.ts|\.yml|\.yaml|\.toml)$/.test(pathname) && fs.existsSync(targetFile)) {
      const rel = path.relative(root, targetFile).split(path.sep).join('/');
      return `href="${repoUrl}/blob/main/${rel}${hash ? `#${hash}` : ''}"`;
    }
    return match;
  });
}

const sidebar = [...pageInfo.values()]
  .filter((page) => page.output.startsWith('docs/') && page.output !== 'docs/index.html')
  .sort((a, b) => a.title.localeCompare(b.title));

function layout(page, body) {
  const prefix = prefixFor(page.output);
  const nav = [
    ['Home', `${prefix}index.html`],
    ['Manual', `${prefix}manual.html`],
    ['Docs', `${prefix}docs/`],
    ['Overview', `${prefix}README.html`],
    ['Changelog', `${prefix}CHANGELOG.html`],
    ['GitHub', repoUrl],
  ];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark light" />
  <title>${page.title.includes('Hyperbolic Gateway') ? page.title : `${page.title} — Hyperbolic Gateway`}</title>
  <link rel="stylesheet" href="${prefix}assets/docs.css" />
</head>
<body>
  <header class="topbar">
    <a class="brand" href="${prefix}index.html">
      <img src="${prefix}assets/brand/hyperbolic-gateway-primary.png" alt="" />
      <span>Hyperbolic Gateway</span>
    </a>
    <nav class="topnav">${nav.map(([label, href]) => `<a href="${href}">${label}</a>`).join('')}</nav>
  </header>
  <div class="shell">
    <aside class="sidebar">
      <div class="side-title">Documentation</div>
      <a class="${page.output === 'docs/index.html' ? 'active' : ''}" href="${prefix}docs/">All docs</a>
      <a class="${page.output === 'README.html' ? 'active' : ''}" href="${prefix}README.html">Overview</a>
      <a class="${page.output === 'CHANGELOG.html' ? 'active' : ''}" href="${prefix}CHANGELOG.html">Changelog</a>
      <div class="side-title">Guides &amp; reference</div>
      ${sidebar.map((item) => `<a class="${item.output === page.output ? 'active' : ''}" href="${prefix}${item.output}">${item.title}</a>`).join('')}
    </aside>
    <main class="content">
      <div class="source-link"><a href="${repoUrl}/blob/main/${path.relative(root, page.file).split(path.sep).join('/')}">View source on GitHub</a></div>
      ${body}
      <footer class="page-footer"><a href="${prefix}index.html">Home</a> · <a href="${prefix}docs/">Documentation</a> · <a href="${repoUrl}">GitHub</a></footer>
    </main>
  </div>
</body>
</html>`;
}

const docsCss = `:root{--bg:#0b1220;--panel:#111a2b;--line:#243653;--text:#e6edf7;--muted:#9aabc2;--cyan:#22d3ee;--green:#a3e635;--violet:#a78bfa;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 8% -10%,rgba(34,211,238,.14),transparent 30rem),var(--bg);color:var(--text);line-height:1.65}a{color:var(--cyan);text-decoration:none}a:hover{text-decoration:underline}.topbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:24px;min-height:66px;padding:0 24px;border-bottom:1px solid var(--line);background:rgba(11,18,32,.9);backdrop-filter:blur(14px)}.brand{display:flex;align-items:center;gap:10px;color:var(--text);font-weight:800;letter-spacing:.08em;text-transform:uppercase;font-size:13px}.brand:hover{text-decoration:none}.brand img{width:30px;height:30px;object-fit:contain}.topnav{display:flex;gap:18px;flex-wrap:wrap;font-size:12px}.topnav a{color:var(--muted)}.shell{display:grid;grid-template-columns:250px minmax(0,1fr);gap:36px;max-width:1240px;margin:0 auto;padding:28px 24px 60px}.sidebar{position:sticky;top:90px;align-self:start;max-height:calc(100vh - 110px);overflow:auto;border-right:1px solid var(--line);padding-right:18px}.side-title{margin:20px 0 7px;color:var(--green);font:700 10px/1.4 ui-monospace,Consolas,monospace;text-transform:uppercase;letter-spacing:.12em}.side-title:first-child{margin-top:0}.sidebar a{display:block;padding:4px 0;color:var(--muted);font-size:12px;line-height:1.45}.sidebar a.active,.sidebar a:hover{color:var(--cyan)}.content{min-width:0;max-width:860px}.source-link{display:flex;justify-content:flex-end;margin-bottom:16px;font-size:11px;color:var(--muted)}.content h1,.content h2,.content h3,.content h4{line-height:1.2;letter-spacing:-.025em;scroll-margin-top:90px}.content h1{font-size:clamp(2rem,5vw,3.4rem);margin:.2em 0 .55em}.content h2{font-size:1.65rem;margin-top:2.1em;padding-top:.35em;border-top:1px solid var(--line)}.content h3{font-size:1.2rem;margin-top:1.7em}.content p,.content li{color:#c4d0e0}.content strong{color:var(--text)}.content code{padding:2px 5px;border-radius:5px;background:#08101c;color:var(--green);font:600 .88em ui-monospace,Consolas,monospace}.content pre{padding:16px;border:1px solid var(--line);border-radius:12px;background:#08101c;overflow:auto}.content pre code{padding:0;background:none;color:#cfe7ff;font-weight:400}.content table{width:100%;border-collapse:collapse;margin:22px 0;font-size:13px}.content th,.content td{padding:9px 11px;border:1px solid var(--line);text-align:left;vertical-align:top}.content th{background:var(--panel);color:var(--text)}.content blockquote{margin:20px 0;padding:10px 16px;border-left:3px solid var(--violet);background:rgba(167,139,250,.07);color:#c9d4e6}.content img{max-width:100%;height:auto;border-radius:10px}.content hr{border:0;border-top:1px solid var(--line);margin:30px 0}.content a.btn{display:inline-block;padding:8px 12px;border:1px solid var(--line);border-radius:8px;color:var(--text);background:var(--panel)}.page-footer{margin-top:48px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}@media(max-width:840px){.shell{display:block;padding-top:20px}.sidebar{position:static;max-height:none;border-right:0;border-bottom:1px solid var(--line);padding:0 0 16px;margin-bottom:24px}.topbar{align-items:flex-start;padding:14px 18px;flex-direction:column;gap:9px}.topnav{gap:12px}.content h1{font-size:2rem}}`;

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(root, 'site'), out, { recursive: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
fs.cpSync(path.join(root, 'public', 'assets'), path.join(out, 'assets'), { recursive: true });
fs.mkdirSync(path.join(out, 'public', 'assets'), { recursive: true });
fs.cpSync(path.join(root, 'public', 'assets'), path.join(out, 'public', 'assets'), { recursive: true });
fs.mkdirSync(path.join(out, 'docs', 'assets'), { recursive: true });
fs.cpSync(path.join(root, 'docs', 'assets'), path.join(out, 'docs', 'assets'), { recursive: true });
fs.mkdirSync(path.join(out, 'kuang_docs'), { recursive: true });
fs.copyFileSync(path.join(root, 'kuang_docs', 'okf.json'), path.join(out, 'kuang_docs', 'okf.json'));
if (fs.existsSync(path.join(root, 'LICENSE'))) fs.copyFileSync(path.join(root, 'LICENSE'), path.join(out, 'LICENSE'));
fs.copyFileSync(path.join(root, 'public', 'welcome.html'), path.join(out, 'manual.html'));
fs.writeFileSync(path.join(out, 'assets', 'docs.css'), docsCss);

for (const page of pageInfo.values()) {
  const html = rewriteLinks(marked.parse(page.markdown, { gfm: true, breaks: false }), page);
  const target = path.join(out, page.output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const rendered = layout(page, html);
  fs.writeFileSync(target, rendered);
  if (page.output === 'docs/index.html') {
    fs.writeFileSync(path.join(out, 'docs/README.html'), rendered);
  }
}

const sitemap = ['index.html', 'manual.html', 'README.html', 'CHANGELOG.html', 'docs/index.html', ...sidebar.map((item) => item.output)];
fs.writeFileSync(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...new Set(sitemap)].map((item) => `  <url><loc>${pagesRoot}/${item}</loc><changefreq>weekly</changefreq></url>`).join('\n')}
</urlset>
`);

console.log(`built ${pageInfo.size} Markdown pages into ${path.relative(root, out)}`);
