import fs from 'fs';
for (const l of ['en', 'fr', 'de', 'es', 'ar']) {
  const t = fs.readFileSync('./translations/' + l + '.json', 'utf8');
  for (const sec of ['chatResponses', 'faq', 'chatTemplates']) {
    const start = t.indexOf('"' + sec + '":');
    if (start < 0) { console.log(l + '/' + sec + ': MISSING SECTION'); continue; }
    // find matching close brace by depth counting
    let depth = 0;
    let i = t.indexOf('{', start);
    const bodyStart = i;
    for (; i < t.length; i++) {
      if (t[i] === '{') depth++;
      else if (t[i] === '}') { depth--; if (depth === 0) break; }
    }
    const body = t.slice(bodyStart, i);
    const keys = [...body.matchAll(/"([^"]+)":/g)].map((x) => x[1]);
    const dups = [...new Set(keys.filter((k, idx) => keys.indexOf(k) !== idx))];
    if (dups.length) console.log(l + '/' + sec + ' DUPS: ' + dups.join(','));
  }
}
console.log('scan done');
