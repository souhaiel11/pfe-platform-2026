import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as marked from 'marked';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const exports = {};
const source = readFileSync(new URL('../src/app/shared/chat-widget/chat-markdown.ts', import.meta.url), 'utf8');
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText, { exports, require: name => {
  assert.equal(name, 'marked');
  return marked;
} });
const render = exports.renderChatMarkdown;
const table = '| Build | Date | Statut |\n|---|---|---|\n| **Build #149** | 21/09/2026 | 🔴 Bloqué |';
const html = render(table);
assert.match(html, /<table>/);
assert.match(html, /<thead>/);
assert.match(html, /<th>Build<\/th>/);
assert.match(html, /<strong>Build #149<\/strong>/);
assert.match(html, /🔴 Bloqué/);
assert.match(html, /class="chat-table-scroll"/);
assert.match(html, /tabindex="0"/);
const formatting = render('# Titre\n\nParagraphe **gras** et *italique*.\nNouvelle ligne\n\n- Un\n- Deux\n\n1. Premier\n2. Second\n\n`inline`\n\n```java\nclass Main {\n  String text = "<script>";\n}\n```\n\n[Documentation](https://example.com/docs)');
for (const tag of ['h1', 'p', 'strong', 'em', 'ul', 'ol', 'li', 'code', 'pre', 'a', 'br']) assert.match(formatting, new RegExp(`<${tag}(?:>|\\s)`));
assert.match(formatting, /&lt;script&gt;/);
assert.match(formatting, /class="language-java"/);
assert.match(formatting, /href="https:\/\/example.com\/docs"/);
const rawHtml = render('<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">');
assert.ok(!rawHtml.includes('<script>'));
assert.ok(!rawHtml.includes('<img'));
assert.match(rawHtml, /&lt;script&gt;/);
assert.match(render('Bonjour\nComment allez-vous ?'), /<br>/);
assert.equal(render(''), '');
const component = readFileSync(new URL('../src/app/shared/chat-widget/chat-markdown.component.ts', import.meta.url), 'utf8');
assert.match(component, /\[innerHTML\]="html"/);
assert.ok(!component.includes('bypassSecurityTrustHtml'));
const template = readFileSync(new URL('../src/app/shared/chat-widget/chat-widget.component.html', import.meta.url), 'utf8');
assert.match(template, /msg.role === 'assistant'; else userContent/);
assert.match(template, /\{\{msg.content\}\}/);
console.log('PASS chat Markdown: tables, formatting, code escaping, line breaks, raw HTML as text and plain user messages');
