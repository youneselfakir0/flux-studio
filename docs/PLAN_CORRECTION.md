# Plan de correction global — Flux Studio

_Généré le 15/10/2026 — audit Hermes + vérification directe contre ComfyUI réel_

---

## 1. Ce qui a été vérifié pour de vrai

| Test | Résultat |
|---|---|
| ComfyUI joignable | ✅ `:8188` répond 200 |
| Graphe frontend | ✅ 9 nœuds, 9 edges, `validate() → valid` |
| Génération réelle SDXL | ✅ `audit_sdxl_00001_.png` produit dans `F:\f\ComfyUI\output` |
| Pipeline Flux | ❌ échec `mat1 and mat2 shapes cannot be multiplied` |
| Gemini enhance | ✅ 200, retourne `{positive, negative}` |
| `scan-files` / `read-header` | ✅ 614 fichiers (mais **POST**, frontend appelle en GET) |
| SSE `/api/comfyui/queue/stream` | ❌ **route inexistante** (référencée par `core/api.js:129`) |

---

## 2. Découvertes techniques (Hermes + tests)

### 2.1 Format ComfyUI réel de cette installation

```
POST /prompt  body = { "prompt": { "<id>": { class_type, inputs } } }
  -> 200 { prompt_id, node_errors: {} }
  -> 400 { error: { type: "prompt_outputs_failed_validation" },
           node_errors: { "<id>": { errors: [{ type, message, details, extra_info }] } } }

GET /history/<prompt_id> -> { "<pid>": { prompt, outputs, status, meta } }
  status.status_str : "success" | "error"
  status.messages   : [["execution_error", { node_id, node_type, exception_message, ... }]]
  outputs["9"].images[0] = { filename, subfolder, type }
GET /queue -> { queue_running: [...], queue_pending: [...] }
GET /view?filename=&subfolder=&type=   -> octets image
```

### 2.2 Pièges de types (source de tous les échecs)

| Piège | Détail |
|---|---|
| Connexions = **index numérique** | `["4", 0]` et **jamais** `["4", "CLIP"]` |
| `CLIPTextEncodeFlux` | exige `clip`(lien) + `clip_l`(STRING) + `t5xxl`(STRING) + `guidance` — pas `text` |
| `KSamplerAdvanced.add_noise` | **valeur littérale** `"enable"`/`"disable"`, pas un lien |
| `return_with_leftover_noise` | idem, littéral |
| `KSamplerAdvanced` (cette build) | n'a **pas** d'entrée `guide` → utiliser `SamplerCustom` |
| `DisableNoise` | renvoie `NOISE` ≠ attendu par `add_noise` (enum) → ne pas l'utiliser |
| `EmptyFlux2LatentImage` vs `EmptyLatentImage` | Flux → 16px aligné ; SDXL/SD → classique |

### 2.3 Pipeline validé

**SDXL (fonctionne, ~30 s)**
```
CheckpointLoaderSimple(sd_xl_base_1.0.safetensors)
  ├─[0]MODEL ────────────────────────────┐
  ├─[1]CLIP ──┬─ CLIPTextEncode(pos) ────┤
  │           └─ CLIPTextEncode(neg) ────┤
  └─[2]VAE ────────────────── VAEDecode  │
EmptyLatentImage(1024,1024,1) ─ LATENT ───┤
SamplerCustom(model, add_noise=true, cfg=7,
  sampler=KSamplerSelect(euler),
  sigmas=BasicScheduler(normal, steps=4)) │
  └─ LATENT ─ VAEDecode ─ SaveImage
```

**Flux v1 (bloqué — config CLIP à déterminer)**
L'erreur `576x64 × 1x98304` indique que le conditioning produit 64 tokens (7680 → clip_l seul) alors que le modèle en attend 98304. Le checkpoint `FLUX Dev (Quantized).safetensors` + `t5xxl + clip_l` ne matche pas. **À tester hors de cette session.**

---

## 3. P0 — Bloquant (l'app ne fait rien)

### P0-1 · Exécuteur de graphe réel
**Fichier** : `app/static/editor/graph.js` + `app/server.py`

`Node._execute()` retourne `{}`. Le bouton « ▶ Run » ne produit aucune image.

**Serveur — 3 routes nouvelles :**
```python
# do_POST
if path == "/api/comfyui/run":
    body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
    req = urllib.request.Request("http://127.0.0.1:8188/prompt",
        data=json.dumps({"prompt": body["prompt"]}).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        r = json.loads(urllib.request.urlopen(req, timeout=30).read())
        return self.send_json({"ok": True, "prompt_id": r["prompt_id"],
                               "node_errors": r.get("node_errors", {})})
    except urllib.error.HTTPError as e:
        return self.send_json(json.loads(e.read()), 400)

# do_GET
if path == "/api/comfyui/history":
    pid = query.get("id", [""])[0]
    d = json.loads(urllib.request.urlopen(f"http://127.0.0.1:8188/history/{pid}", timeout=15).read())
    entry = d.get(pid)
    if not entry:
        return self.send_json({"status": "pending"})
    st = entry.get("status", {})
    err = next((m[1] for m in st.get("messages", []) if m[0] == "execution_error"), None)
    imgs = [im for o in (entry.get("outputs") or {}).values()
                  for k in ("images", "gifs") for im in o.get(k, [])]
    return self.send_json({
        "status": "error" if st.get("status_str") == "error" else ("done" if st.get("completed") else "pending"),
        "error": (err or {}).get("exception_message"),
        "node_id": (err or {}).get("node_id"),
        "images": imgs,
    })

if path == "/api/comfyui/queue":
    return self.send_json(json.loads(urllib.request.urlopen("http://127.0.0.1:8188/queue", timeout=10).read()))
```

**Frontend — `graph.js` :**
```js
export function graphToComfyUI(graph) {
  const prompt = {}, idMap = new Map();
  let i = 1;
  graph.getAllNodes().forEach(n => idMap.set(n.id, String(i++)));
  graph.getAllNodes().forEach(node => {
    const inputs = {};
    node.widgets.forEach((v, name) => { if (v !== null && v !== "") inputs[name] = v; });
    node.inputs.forEach((data, name) => {
      if (!data.connections.size) return;
      const c = [...data.connections][0];
      const src = graph.getNode(c.nodeId);
      const outs = src?.def.outputs || [];
      const idx = outs.findIndex(o => (typeof o === "string" ? o : o.name) === c.outputName);
      inputs[name] = [idMap.get(c.nodeId), idx >= 0 ? idx : 0];
    });
    prompt[idMap.get(node.id)] = { class_type: node.type, inputs };
  });
  return prompt;
}
```

Puis réécrire `Graph.execute()` : validate → `graphToComfyUI` → `POST /api/comfyui/run` → poll `/api/comfyui/history?id=` 1 s → émettre `graph:executed` avec les images.

### P0-2 · Validation des entrées requises
`Graph.validate()` ne vérifie pas les entrées requises → ComfyUI renvoie 400 illisible.

Ajouter dans `validate()` : pour chaque nœud, chaque entrée sans connexion dont le type n'est pas optionnel → warning bloquant. Renommer les entrées KSamplerAdvanced avec des widgets `add_noise` / `return_with_leftover_noise` (valeurs `enable`/`disable`).

### P0-3 · Erreurs ComfyUI remontées à l'utilisateur
Quand `/prompt` répond 400, afficher `node_errors[].errors[].extra_info.input_name` dans l'inspector, pas un toast générique.

---

## 4. P1 — Fonctionnalités cassées

### P1-1 · Scanner : GET au lieu de POST
`app/static/scanner/scanner.js:83` et `:110`
```js
const res = await fetch('/api/comfyui/scan-files', { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' });
```

### P1-2 · Queue batch simulée
`app/static/gallery/grid.js:611-612` — commentaire `// For now, simulate`.
Remplacer par un appel réel `api.comfy.run(...)` + suivi `/history`.

### P1-3 · SSE vers route inexistante
`app/static/core/api.js:129` référence `/api/comfyui/queue/stream`. Supprimer la classe `SSE` ou la brancher sur `/api/comfyui/queue` en polling.

### P1-4 · Modèle de flux dans le registre
`app/static/nodes/registry.js`
- `CLIPTextEncodeFlux` : widgets `clip_l` + `t5xxl` + `guidance` (pas `text`)
- Ajouter `SamplerCustom`, `KSamplerSelect`, `BasicScheduler`, `FluxLoader`, `UNETLoader`
- `KSamplerAdvanced` : widgets `add_noise`/`return_with_leftover_noise` (combo), `noise_seed`

### P1-5 · Noms de fichiers codés en dur
`app/server.py::build_generate_workflow` utilise `flux2_klein_4b.safetensors`, `t5xxl_fp8_e4m3fn.safetensors`, `ae.safetensors`.
Noms réels : `FLUX Dev (Quantized).safetensors`, `flux-2-klein-4b.safetensors` (unet), `flux2-vae.safetensors`.
→ Les widgets doivent se remplir dynamiquement depuis `/api/comfyui/local`.

### P1-6 · `workflows.delete` échoue
`app/static/core/storage.js` — la clé n'est pas propagée. Vérifier que `wfStore.save()` retourne bien l'objet avec `id`.

### P1-7 · `models/browser.js` — forme de réponse
`api.comfy.local()` renvoie `{models:[...]}` mais le navigateur lit `res.models` sur une réponse déjà déballée → double déballage. Vérifier `core/api.js::raw` vs `api.comfy.local`.

### P1-8 · `openFolder` / `deleteModel` = stubs
`models/browser.js` — implémenter via une route serveur (`os.startfile`, `os.remove`) ou retirer les boutons.

---

## 5. P2 — Améliorations

| # | Item | Fichiers |
|---|---|---|
| P2-1 | Upload d'image dans le graphe (`LoadImage` sans bouton réel) | `canvas.js`, `server.py` |
| P2-2 | Nœud `PreviewImage` → affichage direct sans passer par ComfyUI | `registry.js`, `base.js` |
| P2-3 | Persistance des filtres (`base/type/tag/men/nsfw`) | `main.js` |
| P2-4 | Historique de versions de workflow | `library.js` |
| P2-5 | WebSocket `/ws` ComfyUI pour progression temps réel | `server.py` |
| P2-6 | Détection auto du modèle par les nœuds présents | `graph.js` |
| P2-7 | Undo/redo persistant après `rebuildNodes()` | `canvas.js` |

---

## 6. Ordre d'exécution

```
1. P0-1  routes /run /history /queue  →  graphToComfyUI  →  execute()
2. P0-2  validate() entrées requises
3. P0-3  affichage des erreurs ComfyUI
4. P1-5  widgets dynamiques (noms de fichiers réels)
5. P1-4  registre : nœuds Flux/SDXL corrects
6. P1-1  scanner POST
7. P1-2  queue réelle
8. P1-6/7/8  correctifs mineurs
9. P2-*  au fil de l'eau
```

**Critère de recette** : appuyer sur « ▶ Run » avec le graphe par défaut produit un fichier PNG dans `F:\f\ComfyUI\output` et l'affiche dans la gallery.

---

## 7. Question ouverte

Le pipeline **Flux** échoue avec `576x64 × 1x98304` sur les 3 configurations testées (`t5xxl+clip_l/flux`, `t5xxl+clip_l/sdxl`, `FluxLoader`). Le checkpoint installé semble incomplet ou le CLIP mismatch.

Options :
- **(a)** Livre l'app avec SDXL + SD 1.5 fonctionnels,Flux marqué « à configurer »
- **(b)** Réinstaller un checkpoint Flux complet + T5 correct
- **(c)** Chercher la config exacte du checkpoint `FLUX Dev (Quantized)` (poids unet séparés ?)