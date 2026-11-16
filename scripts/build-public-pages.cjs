// Publish support/legal documents independently while release acceptance is pending.
// No app bundle, backend keys, credentials, external scripts or forms are emitted.
const { readFileSync, writeFileSync, mkdirSync, copyFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const headers = require('./web-headers.cjs');

function constants(path) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports }, { timeout: 1000 });
  return exports;
}
const { colors, spacing, radius, layout } = constants('src/theme/index.ts');
const { supportEmail, supportMailto } = constants('src/constants/support.ts');
const out = process.argv[2] || 'dist-public';
const escape = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = (text) =>
  escape(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((\/[a-z/-]+)\)/g, '<a href="$2">$1</a>');
function markdown(text) {
  return text
    .replace(/^> \*\*Draft for founder review\*\*.*$/m, '')
    .split(/\n\s*\n/)
    .map((block) => {
      if (block.startsWith('#')) {
        const match = /^(#{1,3}) (.*)$/.exec(block.trim());
        if (match) return `<h${match[1].length}>${inline(match[2])}</h${match[1].length}>`;
      }
      if (block.startsWith('|')) return `<pre>${escape(block)}</pre>`;
      if (block.startsWith('- '))
        return `<ul>${block
          .split(/\n(?=- )/)
          .map((x) => `<li>${inline(x.replace(/^- /, ''))}</li>`)
          .join('')}</ul>`;
      return `<p>${inline(block.replace(/\n/g, ' '))}</p>`;
    })
    .join('\n');
}
const contact = `<a href="${supportMailto()}">${escape(supportEmail)}</a>`;
const pages = {
  '': {
    title: 'Guardians support',
    body: `<h1>Guardians</h1><p>Community cat rescue. Our app release is being prepared.</p><h2>Support and account deletion</h2><p>For account help, deletion requests, or abuse reports, contact ${contact}.</p><p>Never send passwords, sign-in links, ID photos, or precise private locations by email.</p><p><a href="/delete-account">How to delete your account and data</a></p>`,
  },
  support: {
    title: 'Guardians support',
    body: `<h1>Guardians support</h1><p>Get help with your account, report a problem, or request account and data deletion without signing in.</p><p>Email ${contact}. For abuse reports include a listing link and a short description.</p><p>Never send passwords, sign-in links, ID photos, or precise private locations by email.</p><p><a href="/delete-account">Request account deletion</a></p>`,
  },
  'delete-account': {
    title: 'Delete your Guardians account',
    body:
      markdown(readFileSync('docs/legal/account-deletion.md', 'utf8')) +
      `<p><a href="${supportMailto(true)}">Email an account deletion request</a></p>`,
  },
  privacy: {
    title: 'Guardians Privacy Policy',
    body: markdown(readFileSync('docs/legal/privacy-policy.md', 'utf8')),
  },
  terms: {
    title: 'Guardians Terms of Service',
    body: markdown(readFileSync('docs/legal/terms.md', 'utf8')),
  },
};
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, 'style.css'),
  `body{margin:0;background:${colors.background};color:${colors.text};font:17px/1.6 system-ui,sans-serif}main{max-width:${layout.contentMax}px;margin:auto;padding:${spacing.xxxl}px ${spacing.xl}px}nav{display:flex;gap:${spacing.lg}px;flex-wrap:wrap}a{color:${colors.primary};overflow-wrap:anywhere}h1{line-height:1.15}h2{margin-top:${spacing.xxxl}px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}section{background:${colors.surface};padding:${spacing.xl}px;border-radius:${radius.lg}px}footer{margin-top:${spacing.xxxl}px}*{box-sizing:border-box}`,
);
copyFileSync('assets/favicon.png', join(out, 'favicon.png'));
for (const [route, page] of Object.entries(pages)) {
  const path = join(out, route);
  mkdirSync(path, { recursive: true });
  writeFileSync(
    join(path, 'index.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escape(page.title)}</title><link rel="icon" href="/favicon.png"><link rel="stylesheet" href="/style.css"></head><body><main><nav aria-label="Main"><a href="/">Guardians</a><a href="/support">Support</a><a href="/delete-account">Account deletion</a></nav><section>${page.body}</section><footer><a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a></footer></main></body></html>`,
  );
}
mkdirSync(join(out, '_expo'), { recursive: true });
writeFileSync(
  join(out, '_expo', '.routes.json'),
  JSON.stringify({
    headers: {
      ...headers,
      'Content-Security-Policy':
        "default-src 'none'; img-src 'self'; style-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
    },
    redirects: [],
  }),
);
console.log('Public support and legal pages generated. No app or credentials included.');
