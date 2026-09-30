// Regression guard for the orphaned-routing bug class found in Phase 8.
//
// Several legacy `currentMenu === 'X'` branches in src/index.js bound numeric
// input with a hardcoded regex and repeated the same bound in the rejection
// message. Adding an option to a menu therefore made it silently unreachable:
// General Settings rendered 5 options behind a 0-3 gate, so options 4 and 5
// were rejected before the router ever ran.
//
// This test parses those gates out of index.js and checks each one against
// independent signals for what that menu actually offers:
//
//   A. the menu builder's highest hardcoded option row, for legacy panels
//      that render 'N. <label>' string literals
//   B. the highest `case 'N':` implemented by the handler the gate dispatches
//      to (only when that handler serves a single session -- a handler shared
//      by several sessions has a union of cases that no single bound can match)
//
// It also asserts each gate's regex and its rejection message agree, and that
// no gate targets a session id nothing ever assigns (dead branches).
//
// Pure static analysis: no data/ writes, no network, safe to run anytime.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, '..', 'src');
const indexSrc = fs.readFileSync(path.join(srcDir, 'index.js'), 'utf8');

let fails = 0;
let skipped = 0;
function check(name, cond, extra = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra && !cond ? ' :: ' + String(extra).slice(0, 300) : ''));
  if (!cond) fails++;
}

// ---------------------------------------------------------------------------
// Source index
// ---------------------------------------------------------------------------

const jsFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith('.js')) jsFiles.push({ full, text: fs.readFileSync(full, 'utf8') });
  }
})(srcDir);

function functionBody(name) {
  const re = new RegExp('(?:export\\s+)?(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  for (const { text } of jsFiles) {
    const hit = text.match(re);
    if (!hit) continue;
    let i = text.indexOf('{', hit.index);
    let depth = 0;
    let end = i;
    for (; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') { depth--; if (!depth) { end = i; break; } }
    }
    return text.slice(hit.index, end + 1);
  }
  return null;
}

const pascal = (snake) => snake.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join('');

// Every session id anything in src/ can install as session.currentMenu: the
// literal setState assignments, plus the `sessionMenu` a menu definition asks
// sendMenuById to install.
const assignable = new Set();
for (const { text } of jsFiles) {
  for (const m of text.matchAll(/currentMenu\s*[:=]\s*'([A-Za-z_0-9]+)'/g)) assignable.add(m[1]);
  for (const m of text.matchAll(/sessionMenu\s*[:=]\s*'([A-Za-z_0-9]+)'/g)) assignable.add(m[1]);
}

// ---------------------------------------------------------------------------
// Parse the gates
// ---------------------------------------------------------------------------

// /^[0-5]$/ -> 5 ; /^(1[0-3]|[0-9])$/ -> 13 ; /^([0-9]|10)$/ -> 10 ; /^\d+$/ -> null
function regexBound(body) {
  // A leading digit multiplies a range: '1[0-3]' is 10-13, '[0-3]' is 0-3.
  const ranges = [...body.matchAll(/(\d*)\[(\d+)-(\d+)\]/g)].map((m) => Number(m[1] + m[3]));
  // The digit-class idiom: '1[01]' is 10-11, '[012]' is 0-2.
  const classes = [...body.matchAll(/(\d*)\[([\d]{2,})\]/g)].map((m) => Number(m[1] + m[2].slice(-1)));
  const multi = [...body.matchAll(/\|\s*(\d{2,})/g)].map((m) => Number(m[1]));
  const bounds = [...ranges, ...classes, ...multi];
  return bounds.length ? Math.max(...bounds) : null;
}

const gateBlocks = [];
const gateStart = /currentMenu\s*===\s*'([A-Za-z_0-9]+)'\s*\)\s*\{/g;
const starts = [];
let m;
while ((m = gateStart.exec(indexSrc))) starts.push({ session: m[1], at: m.index });
for (let i = 0; i < starts.length; i++) {
  const block = indexSrc.slice(starts[i].at, i + 1 < starts.length ? starts[i + 1].at : indexSrc.length);
  const rx = block.match(/\/\^([^\/\n]+)\$\/\.test\(trimmedText\)/);
  if (!rx) continue;
  const bound = regexBound(rx[1]);
  if (bound === null) continue;
  gateBlocks.push({
    session: starts[i].session,
    bound,
    declaredMax: (block.match(/max:\s*(\d+)/) || [])[1] ?? null,
    handler: (block.match(/await\s+(handle\w+)\s*\(/) || [])[1] ?? null
  });
}

// How many times each handler is dispatched anywhere in src/ -- a handler with
// several call sites serves several sessions, so its union of `case 'N':`
// values cannot be compared against any single gate's bound.
const handlerCalls = new Map();
function callCount(name) {
  if (!handlerCalls.has(name)) {
    // Count call sites only; exclude the `function name(` declaration itself.
    const re = new RegExp('(?<!function )\\b' + name + '\\s*\\(', 'g');
    let n = 0;
    for (const { text } of jsFiles) n += (text.match(re) || []).length;
    handlerCalls.set(name, n);
  }
  return handlerCalls.get(name);
}

console.log('parsed ' + gateBlocks.length + ' bounded menu gates from src/index.js');
console.log('');

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

for (const g of gateBlocks) {
  const label = g.session + ' [bound ' + g.bound + ']';

  // 1. The regex and the rejection message must not disagree.
  if (g.declaredMax !== null) {
    check(label + ': rejection message max matches the regex', Number(g.declaredMax) === g.bound, 'regex ' + g.bound + ' vs max ' + g.declaredMax);
  }

  // 2. No gate may target a session id nothing assigns (dead branch).
  check(label + ': session id is reachable', assignable.has(g.session), 'nothing assigns currentMenu ' + g.session);

  let required = 0;
  const reasons = [];

  // 3. Signal A -- the legacy panel builder's highest option row.
  const builderName = 'build' + pascal(g.session) + 'Menu';
  const builder = functionBody(builderName);
  if (builder) {
    const rows = [...builder.matchAll(/'(\d+)\.\s/g)].map((x) => Number(x[1]));
    if (rows.length) {
      required = Math.max(required, Math.max(...rows));
      reasons.push(builderName + '=' + required);
    }
  }

  // 4. Signal B -- the highest case the dispatched handler implements.
  //    Only meaningful when the handler has a single call site; one shared
  //    across sessions has a union of cases no single bound can match.
  if (g.handler) {
    const calls = callCount(g.handler);
    if (calls === 1) {
      const body = functionBody(g.handler);
      if (body) {
        const cases = [...body.matchAll(/case\s+'(\d+)'\s*:/g)].map((x) => Number(x[1]));
        if (cases.length) {
          const highest = Math.max(...cases);
          required = Math.max(required, highest);
          reasons.push(g.handler + '=' + highest);
        }
      }
    } else {
      skipped++;
    }
  }

  if (required === 0) {
    console.log('SKIP ' + label + ': no menu builder and no single-session handler to compare against');
    continue;
  }
  check(label + ': bound covers every option (' + reasons.join(', ') + ')', g.bound >= required, 'option ' + required + ' is unreachable');
}

console.log('');
console.log('gates checked:   ' + gateBlocks.length);
console.log('shared handlers skipped for signal B: ' + skipped);
console.log('failures:        ' + fails);
console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);