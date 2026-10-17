/**
 * Audit registre ↔ ComfyUI — à coller dans la console navigateur.
 *
 * Compare /nodes/registry.js contre /api/comfyui/nodeinfo.
 * 3 classes de bogues :
 *   badPort       : port déclaré qui n'existe pas (CASE SENSITIVE)
 *   widgetIsPort  : widget déclaré alors que ComfyUI attend un lien
 *   missingInput  : entrée ComfyUI non couverte (ni port ni widget)
 */
(async function auditRegistry() {
  const reg = await import('/nodes/registry.js');
  const info = await fetch('/api/comfyui/nodeinfo').then(r => r.json());
  if (info.error) return { fatal: info.error };

  // Les widgets ComfyUI apparaissent aussi dans input.required : il faut
  // distinguer les widgets des vrais liens via le type (LINK/COMBO/STRING).
  const raw = await fetch('http://127.0.0.1:8188/object_info').then(r => r.json()).catch(() => null);

  const linkInputs = (type) => {
    const d = raw && raw[type];
    if (!d) return null;
    const out = new Set();
    for (const sect of ['required', 'optional']) {
      for (const [k, v] of Object.entries(d.input?.[sect] || {})) {
        const spec = Array.isArray(v) ? v[0] : v;
        const isCombo = Array.isArray(spec) && spec.every(x => typeof x === 'string');
        const isLink = spec === 'INT' || spec === 'FLOAT' || spec === 'STRING' || spec === 'BOOLEAN'
          ? false
          : (typeof spec === 'string' && ['INT','FLOAT','STRING','BOOLEAN','COMBO'].includes(spec));
        if (!isCombo && !isLink) out.add(k); // type = lien (MODEL, LATENT, IMAGE...)
      }
    }
    return out;
  };

  const report = { ok: [], bad: [], notInComfy: [] };
  const seen = new Set();

  for (const d of reg.NodeRegistry) {
    if (seen.has(d.type)) continue;
    seen.add(d.type);
    const real = info[d.type];
    if (!real) { report.notInComfy.push(d.type); continue; }

    const links = linkInputs(d.type);
    const realAll = (real.required || []).concat(real.optional || []);
    const mine = (d.inputs || []).map(i => (typeof i === 'string' ? i : i.name));
    const widgets = (d.widgets || []).map(w => w.name);

    const problems = [];

    // 1. ports declares qui n'existent pas (casse exacte)
    for (const m of mine) {
      if (!realAll.includes(m)) {
        problems.push({
          kind: 'badPort',
          declared: m,
          hint: links && links.has(m.toLowerCase())
            ? `ATTENTION casse : ComfyUI attend "${[...links].find(l => l.toLowerCase() === m.toLowerCase())}"`
            : 'port inexistant',
        });
      }
    }
    // 2. widget declare mais ComfyUI attend un lien
    if (links) {
      for (const w of widgets) {
        if (links.has(w)) problems.push({ kind: 'widgetIsPort', declared: w });
      }
    }
    // 3. entrees ComfyUI non couvertes
    for (const r of realAll) {
      if (mine.includes(r) || widgets.includes(r)) continue;
      if (links && !links.has(r)) continue;  // widget manquant -> handled elsewhere
      problems.push({ kind: 'missingLink', declared: r });
    }
    // 4. widgets requis ComfyUI absents du registre
    for (const r of real.required || []) {
      if (mine.includes(r) || widgets.includes(r)) continue;
      if (links && links.has(r)) continue;
      problems.push({ kind: 'missingWidget', declared: r, realAll });
    }

    if (problems.length) report.bad.push({ type: d.type, problems });
    else report.ok.push(d.type);
  }

  return {
    summary: { ok: report.ok.length, bad: report.bad.length, notInComfy: report.notInComfy.length },
    notInComfy: report.notInComfy,
    bad: report.bad,
  };
})();