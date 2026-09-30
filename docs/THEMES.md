# Créer un thème RL-UI

Un thème change la DA de **tous les overlays** (compteur, alertes, dernières parties, récap) : couleurs, images, police et sons. Pas besoin de savoir coder : la plupart des thèmes se font en remplaçant deux images et trois couleurs.

> [!TIP]
> Le plus simple : dans RL-UI, **Overlays OBS → Thèmes → Personnaliser** sur le thème **« Modèle (avec images) »**. Une copie modifiable est créée et son dossier s'ouvre. Chaque fois que tu enregistres un fichier, les overlays se mettent à jour **en direct**, même dans OBS.

## Contenu d'un thème

```text
mon-theme/
├── theme.json        # nom, auteur, couleurs, sons   (obligatoire)
├── theme.css         # ta mise en forme              (facultatif)
├── preview.png       # vignette affichée dans RL-UI  (facultatif, 480 × 120 conseillé)
├── images/           # .png .jpg .webp .gif .svg
├── fonts/            # .woff2 .woff .ttf .otf
└── sounds/           # .mp3 .wav .ogg
```

Les thèmes perso sont rangés dans le dossier de données de RL-UI (`%APPDATA%\RL-UI\themes`, bouton **Ouvrir le dossier des thèmes**).

## theme.json

```json
{
  "name": "Ma DA",
  "author": "Ton pseudo",
  "version": "1.0.0",
  "description": "Une phrase qui décrit le thème.",
  "colors": { "win": "#35e0ff", "loss": "#ff5470", "ot": "#ffc23d" },
  "sounds": { "win": "sounds/victoire.mp3", "overtime": "sounds/ot.mp3" }
}
```

| Champ | Rôle |
| --- | --- |
| `colors` | Couleurs victoire / défaite / overtime, au format `#rrggbb`. Utilisées partout (chiffres, halos, confettis). Désactivables dans RL-UI (« Utiliser les couleurs du thème »). |
| `sounds` | Sons des alertes. Types : `win`, `loss`, `overtime`, `ot_win`, `ot_loss`, `streak`. Un son perso choisi dans RL-UI reste prioritaire. |

## theme.css

`theme.css` est chargé **après** le style d'origine : tu ne réécris que ce que tu veux changer. Les chemins `url(...)` sont relatifs au dossier du thème.

### Variables

| Variable | Rôle |
| --- | --- |
| `--win`, `--loss`, `--ot` | Couleurs (déjà remplies depuis `theme.json`) |
| `--font` | Police des overlays |
| `--s` | Échelle (taille réglée dans RL-UI) : `calc(40px * var(--s))` |

```css
@font-face { font-family: 'MaPolice'; src: url('fonts/ma-police.woff2'); }
:root { --font: 'MaPolice'; }
```

### Cibler un overlay

Chaque page porte une classe sur `<body>` : `.ov-counter`, `.ov-alerts`, `.ov-history`, `.ov-summary`. Le thème actif ajoute aussi `.pack-<id>`.

### Éléments modifiables

**Compteur** (`.ov-counter`)

| Sélecteur | Élément |
| --- | --- |
| `.w` | Le compteur entier (dispositions horizontale et verticale) |
| `.theme-arena` / `.theme-broadcast` / `.theme-minimal` | Le style choisi dans RL-UI ; `::before` = liseré du haut |
| `.cell.win .num`, `.cell.loss .num`, `.lbl` | Chiffres V / D et leurs lettres |
| `.st`, `.st b`, `.st i` | Cases de stats (winrate, série, OT, MMR), valeur, libellé |
| `.otbadge` | Badge « OVERTIME » pendant les prolongations |
| `.boost`, `.bfill`, `.brim` | Disposition « Boost » (collée à la jauge) |
| `.deco` | **Emplacement libre pour une image de fond** (dans `.w` et `.boost`) |

**Alertes** (`.ov-alerts`)

| Sélecteur | Élément |
| --- | --- |
| `.al` + `.t-win`, `.t-loss`, `.t-overtime`, `.t-ot_win`, `.t-ot_loss`, `.t-streak` | Une alerte, selon son type |
| `.kicker` | Petite ligne au-dessus (mode de jeu) |
| `.title .tx` | Le grand titre |
| `.chip`, `.chip.hl`, `.chip.mmr` | Pastilles sous le titre (score, MMR, série…) |
| `.art` | **Emplacement libre pour une image** (logo, mascotte), centré sur l'alerte |

**Dernières parties** (`.ov-history`) : `.bar`, `.pill`, `.ttl`, `.deco`.
**Récap de session** (`.ov-summary`) : `.card`, `.big b`, `.tile`, `.pill`, `.deco`.

### Exemples

```css
/* Image de fond du compteur */
.ov-counter .w .deco { background: url('images/fond.png') center / cover; }
.ov-counter .theme-arena { background: transparent; }

/* Logo au-dessus des alertes de victoire uniquement */
.ov-alerts .al.t-win .art {
  width: calc(160px * var(--s)); height: calc(160px * var(--s));
  top: 0; transform: translate(-50%, -105%);
  background: url('images/logo.png') center / contain no-repeat;
}

/* Titre des défaites en gris */
.ov-alerts .al.t-loss .title .tx { color: #9aa3b2; }
```

## Partager un thème

- **Exporter** (dans RL-UI) crée un `.zip` du thème.
- Les autres cliquent **Installer un thème (.zip)** : c'est tout.
- Réinstaller un thème du même nom met à jour la version perso ; les thèmes intégrés ne sont jamais écrasés.

## Sécurité

Un thème ne peut contenir **aucun script** : seuls les fichiers listés plus haut sont acceptés, les autres (`.js`, `.html`, `.exe`…) sont ignorés à l'installation. Les fichiers sont servis avec une politique de sécurité stricte : un thème ne peut ni exécuter de code ni charger quoi que ce soit depuis Internet.
