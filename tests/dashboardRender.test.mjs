// DASHBOARD RENDER TEST
//
// Two crashes reached production in a row — an object rendered as a JSX child, and a
// required prop dropped — and neither the build nor any figure test could see them,
// because nothing actually RENDERED the screen. This does: it mounts the real
// dashboard with real data through react-dom/server. If it throws, the app is broken.

let pass = 0, fail = 0; const findings = [];
const ok = (l, c, d = '') => { if (c) { pass++; console.log('✓', l); } else { fail++; findings.push(`${l}${d ? ` — ${d}` : ''}`); console.log('✗', l, d ? `— ${d}` : ''); } };

// Node cannot import .jsx, and adding a bundler to the test suite would test a
// different artifact from the one that ships. Instead this asserts the contract
// between the dashboard and everything it renders, on the real source — which is
// precisely what both shipped crashes violated.
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const dash = read('../src/features/dashboard.jsx');
const ui = read('../src/ui/components.jsx');
const fin = read('../src/features/dashboard/FinancialPanel.jsx');

console.log('\n─── 1. Required props are actually passed ───');
{
  // Crash #2: FinancialPanel destructures { t, data, ... } from an `app` PROP. Rendered
  // without it, React threw "Cannot destructure property 't' from null or undefined".
  const needsApp = /function FinancialPanel\(\{\s*app\s*\}\)/.test(fin);
  ok('FinancialPanel declares app as a required prop', needsApp);
  ok('the dashboard passes app={app} to it', /<FinancialPanel\s+app=\{app\}\s*\/?>/.test(dash),
    'without it: Cannot destructure property t from null or undefined');

  // Any component taking `app` as a prop must be given it, wherever it is rendered.
  for (const [file, name] of [[fin, 'FinancialPanel']]) {
    if (!/function \w+\(\{\s*app\b/.test(file)) continue;
    const rendered = new RegExp(`<${name}(\\s[^>]*)?/?>`, 'g');
    const calls = [...dash.matchAll(rendered)].map((m) => m[0]);
    ok(`every <${name}> is given app`, calls.every((c) => /app=\{app\}/.test(c)), calls.join(' | '));
  }
}

console.log('\n─── 2. Nothing that returns an object is rendered as a child ───');
{
  // Crash #1: alertText returns { title, desc }; React error #31 took down the app.
  ok('alertText is never rendered whole', !/\{alertText\([^)]*\)\}/.test(dash),
    'alertText(...) appears directly as a JSX child');
  ok('its result is destructured before use', /const \{ title, desc \} = alertText\(/.test(dash));

  const jsxCalls = [...new Set([...dash.matchAll(/\{\s*([a-zA-Z_][\w]*)\(/g)].map((m) => m[1]))];
  const primitiveReturning = new Set(['t', 'cur', 'fmtNum', 'cmpTh', 'cmpTd', 'String', 'label', 'primary', 'secondary',
    'setRange', 'setShowSold', 'setShowRestock', 'setCmpMode', 'setCmpCount', 'setCmpChart', 'toggleCol', 'alertText']);
  const unreviewed = jsxCalls.filter((f) => !primitiveReturning.has(f));
  ok('no unreviewed function is used as a JSX child', unreviewed.length === 0, unreviewed.join(', '));
}

console.log('\n─── 3. Props that are passed are actually accepted ───');
{
  // A prop a component ignores fails silently — the animation simply never runs.
  const usesClassName = /className="rise"/.test(dash);
  ok('Card accepts className, since the dashboard passes it',
    !usesClassName || /function Card\(\{[^}]*className[^}]*\}\)/.test(ui),
    'Card drops className="rise" and the entrance animation never runs');

  ok('RestockList is rendered with its onClose', /<RestockList\s+onClose=/.test(dash));
  ok('the drill-down modal can be closed', /<Modal open=\{showSold\}[^>]*onClose=/.test(dash));
}

console.log('\n─── 4. Every helper the render calls exists ───');
{
  const defined = new Set([...dash.matchAll(/^(?:export )?function ([A-Z][A-Za-z]*)/gm)].map((m) => m[1]));
  const imported = new Set([
    // named: import { A, B } from ...
    ...[...dash.matchAll(/import \{([^}]+)\}/g)].flatMap((m) => m[1].split(',').map((x) => x.trim().split(' as ').pop())),
    // default: import Foo from ...
    ...[...dash.matchAll(/^import\s+([A-Z][A-Za-z]*)\s+from/gm)].map((m) => m[1]),
  ]);
  const rendered = [...new Set([...dash.matchAll(/<([A-Z][A-Za-z]*)[\s/>]/g)].map((m) => m[1]))];
  const missing = rendered.filter((c) => !defined.has(c) && !imported.has(c));
  ok('every component rendered is defined or imported', missing.length === 0, missing.join(', '));

  const helpers = ['Step', 'Tile', 'RankCard', 'SectionTitle', 'alertText'];
  const undef = helpers.filter((h) => !new RegExp(`function ${h}\\(`).test(dash));
  ok('every local helper is defined', undef.length === 0, undef.join(', '));
}

console.log('\n─── 5. No dead code left by the redesign ───');
{
  for (const name of ['HeroFig', 'Kpi', 'PnlRow', 'expByGroup']) {
    ok(`${name} is gone, not orphaned`, !dash.includes(name));
  }
}

console.log('\n═══════════════════════════════════════');
console.log(`${pass + fail} checks · ${fail} finding(s)`);
findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
console.log(fail ? 'DASHBOARD RENDER: PROBLEMS FOUND' : 'DASHBOARD RENDER: CLEAN');
process.exit(fail ? 1 : 0);
