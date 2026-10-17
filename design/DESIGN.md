# Design System — « Dark Studio Pro »

> Généré avec **Stitch** · projet `Flux Studio` (`projects/2383638101138649318`)
> design system `assets/0702ce610ecb4cc482c73fe113669b9d`
> Implémenté dans `app/static/app.css` (tokens dans `:root`).

## Brand & Style

Atelier numérique sombre, précis et immersif. Minimalisme sombre + glassmorphism
fonctionnel + accents luminescents ultra-ciblés + bordures filaires à faible opacité.
L'interface est un cadre neutre : ce sont **les images créées** qui portent la couleur.

## Couleurs

| Rôle | Token | Hex |
|---|---|---|
| Fond | `--bg` | `#0c0e11` |
| Surface | `--surface` | `#111317` |
| Surface 2 | `--surface-2` | `#1e2023` |
| Surface 3 | `--surface-3` | `#26282c` |
| Ligne | `--line` | `#2c2f34` |
| Texte | `--text` | `#e2e2e6` |
| Texte secondaire | `--muted` | `#8b8794` |
| Primaire (clair) | `--primary` | `#cabeff` |
| Primaire | `--primary-container` | `#947dff` |
| Primaire (profond) | `--primary-strong` | `#603ce2` |
| Accent | `--accent` | `#00eefc` |
| Tertiaire (succès) | `--tertiary` | `#4edea3` |
| Erreur | `--error` | `#ffb4ab` |

### Badges NSFW

| Niveau | Classe | Hex |
|---|---|---|
| None | `.badge.none` | `#10b981` |
| Soft | `.badge.soft` | `#f59e0b` |
| Mature | `.badge.mature` | `#f97316` |
| X | `.badge.x` | `#ef4444` |

## Typographie

- **Space Grotesk** — titres, chiffres clés (`.display`, `h1..h4`, `.stat .v`)
- **Inter** — texte courant
- **JetBrains Mono** — prompts, chemins, valeurs de paramètres (`.mono`, `.codebox`)

## Formes & profondeur

- Rayons : `8 / 12 / 16 / 22 / pleine pastille`
- Ombres : `--shadow-1` (plat), `--shadow-2` (survol de carte), `--shadow-3` (drawer)
- Glow primaire : `--glow` (bouton primaire, marque)

## Composants

- **Rail** gauche : marque, navigation (studio + bases), état.
- **Topbar** : recherche pilule, segmented NSFW (None/Soft/Mature/X), switch *Safe*.
- **Carte de prompt** : vignette 3:4, badges en surimpression, titre, extrait de prompt, actions.
- **Safe mode** : `body.safe .thumb.nsfw img { filter: blur(16px) }` + overlay « NSFW — survolez », révélé au survol.
- **Drawer** : détail d'un prompt (image, prompt pos/nég, paramètres, ressources, actions).
- **Table** : liste de fichiers ComfyUI (nom, type, base, taille, dossier).
- **Stat card**, **progress bar**, **tabs**, **chips**, **toasts**, **drop zone**.

## Écrans Stitch de référence

| Fichier | Écran | Id Stitch |
|---|---|---|
| `screens/01-explorateur.png` | Explorateur de prompts | `abd9ddc25efd4c90949b62c1c82270df` |
| `screens/02b-detail.png` | Fiche détail d'un prompt | `e38028abc690498fa3ef9089d120e8b7` |
| `screens/03-comfyui.png` | Gestionnaire ComfyUI | `3a2f49103f3144da84b11fac3af599ba` |
| `screens/04-image.png` | Image → description | `b31dcf6c148a47d69e9e42f3380e861c` |
| `screens/05-profil.png` | Profil / matériel | `fe48957c60124efdb6833eeeba09f507` |
| `screens/06-workflows.png` | Workflows | `cb33c71461f24e6d9bdada2ce4455c57` |

## Règles d'usage

1. Ne jamais mettre plus d'un accent vif par vue.
2. Les images sont la couleur ; l'UI reste neutre (gris/anthracite).
3. Bordures fines (`1px`) à faible opacité plutôt que des fonds marqués.
4. Le NSFW est **toujours** signalé par un badge de couleur, et flouté hors survol en safe mode.
