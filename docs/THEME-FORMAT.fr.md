# Thèmes composés : le format (format 2)

[English](THEME-FORMAT.md) · **Français**

Un thème composé est ce que produit l'**éditeur de thèmes** (Overlays → Thèmes → Créer un thème), et le seul type de thème que la **galerie de la communauté** accepte. Il est décrit entièrement par des données : une toile et des éléments posés dessus. Il ne contient **ni CSS ni script** : installer le thème de quelqu'un d'autre ne peut donc rien exécuter sur ton PC.

Tu n'as jamais à écrire ce fichier à la main : l'éditeur s'en charge. Cette page est la référence pour qui veut comprendre, fabriquer ou vérifier un thème.

> Les thèmes à feuille de style (`theme.css`, format 1) fonctionnent toujours dans RL-UI et sont décrits dans [THEMES.fr.md](THEMES.fr.md). Ils ne peuvent pas être publiés dans la galerie.

## Le dossier

```text
mon-theme/
├── theme.json        # le thème (obligatoire)
├── preview.png       # vignette, fabriquée par l'éditeur à l'enregistrement (obligatoire pour la galerie)
├── images/           # .png .jpg .webp .gif utilisées par le thème
└── README.md         # facultatif
```

Rien d'autre n'est permis dans le dossier. Les images sont reconnues à leur contenu, pas à leur nom ; les `.svg` sont refusés.

## theme.json

```json
{
  "format": 2,
  "name": "Neon Night",
  "author": "Zoxam",
  "version": "1.0.0",
  "description": "A dark plate with glowing violet edges.",
  "tags": ["neon", "dark"],
  "minApp": "2.0.0",
  "colors": { "win": "#3dffd0", "loss": "#ff4fa8", "ot": "#ffe04d" },
  "base": "contraste",
  "translations": { "fr": { "name": "Nuit néon", "description": "Une plaque sombre aux bords violets lumineux." } },
  "counter": { "width": 1000, "height": 220, "elements": [] },
  "alerts": { "width": 1920, "height": 1080, "enter": "slide", "elements": [] }
}
```

| Champ | Rôle |
| --- | --- |
| `format` | Toujours `2`. |
| `name` | 60 caractères au plus. Obligatoire. |
| `author`, `description` | 60 et 300 caractères au plus. Obligatoires pour la galerie. |
| `version` | `majeur.mineur.correctif`. Une mise à jour doit avoir une version plus élevée que celle en ligne. |
| `tags` | Jusqu'à 5 parmi `minimal`, `competitive`, `neon`, `dark`, `light`, `colorful`, `retro`, `esport`, `compact`, `vertical`. |
| `minApp` | La plus ancienne version de RL-UI capable d'afficher le thème. La galerie ne laisse pas un RL-UI plus ancien l'installer. |
| `colors` | Couleurs victoire / défaite / overtime, `#rrggbb`. Utilisées par les noms de couleur `win`, `loss`, `ot` ci-dessous, et par les alertes. |
| `base` | Habillage des overlays que le thème ne dessine pas lui-même : `signature`, `epure` ou `contraste`. |
| `translations` | Nom et description facultatifs en `en` ou `fr`. |
| `counter` | La composition du compteur V/D (ci-dessous). Obligatoire pour la galerie. |
| `alerts`, `history`, `summary` | Facultatifs : la composition des alertes, des dernières parties et du récap de session. |

Un thème composé dessine toujours le **compteur**. Il peut aussi dessiner les **alertes**, les **dernières parties** et le **récap de session** ; ceux qu'il ne dessine pas gardent l'habillage `base`. La disposition « Boost » du compteur et l'overlay caster gardent leur propre habillage avec tous les thèmes.

## La composition

Une composition est une toile (`width` 40–1920, `height` 20–1080, en pixels) et jusqu'à 80 `elements`, dessinés dans l'ordre (le dernier au-dessus). Les quatre overlays utilisent les mêmes éléments ; seules changent les valeurs en direct et les conditions disponibles.

| Composition | Toile proposée | Remarques |
| --- | --- | --- |
| `counter` | 1000 × 220 | La taille de la source OBS. |
| `alerts` | 1920 × 1080 | Une seule composition pour toutes les alertes : les conditions `alert…` disent quels éléments apparaissent pour quelle alerte. La toile est ajustée et centrée dans la source. `enter` choisit l'entrée en scène : `slide`, `rise`, `pop`, `fade` ou `none`. |
| `history` | 700 × 90 | La taille de la source OBS. |
| `summary` | 1920 × 1080 | La toile est ajustée et centrée dans la source. |

Chaque élément a :

| Champ | Valeurs |
| --- | --- |
| `type` | `box`, `text`, `value`, `image`, `results`, `bar` |
| `id` | Lettres minuscules et chiffres, unique. Donné automatiquement s'il manque. |
| `name` | Nom du calque dans l'éditeur (40 caractères). |
| `x`, `y`, `w`, `h` | Position et taille en pixels. |
| `rotate` | −180 à 180 degrés. |
| `opacity` | 0 à 1. |
| `when` | Quand l'élément est visible : `always` ou l'une des conditions ci-dessous. |
| `hidden` | `true` pour garder l'élément dans le thème sans l'afficher. |

| `when` | Visible… | Overlays |
| --- | --- | --- |
| `match`, `idle`, `overtime` | pendant une partie, entre deux parties, en overtime | compteur |
| `winStreak`, `lossStreak` | à partir de 2 victoires (ou défaites) de suite | compteur, dernières parties, récap ; `winStreak` aussi dans les alertes |
| `mmr` | quand le MMR est connu | compteur, dernières parties, récap |
| `alertWin`, `alertLoss` | pour une victoire, une défaite (overtime compris) | alertes |
| `alertOt` | quand l'overtime commence | alertes |
| `alertOtEnd` | pour une victoire ou une défaite en overtime | alertes |
| `alertStreak` | pour une série de victoires | alertes |
| `alertMvp` | quand la victoire vient avec le MVP | alertes |
| `matchScore`, `matchMmr` | quand le score, ou la variation de MMR de la partie, est connu | alertes |

L'éditeur ne propose pour chaque overlay que les conditions de sa ligne. Une condition écrite à la main dans un autre overlay ne casse rien, mais n'y a pas de sens.

Une couleur est un `#rrggbb` ou l'un de ces noms : `win`, `loss`, `ot` (les couleurs du thème), `white`, `black`, pour les valeurs en direct `auto` (la couleur de victoire en hausse, celle de défaite en baisse, doré en série de victoires, bleu en série de défaites), et dans les alertes `event` : la couleur de l'alerte affichée (victoire, défaite, ou overtime pour un début d'overtime et une série).

### `box` — une plaque

`fill`, `fillOpacity`, `radius` (coins arrondis), `cut` et `cutCorner` (`tr`, `tl`, `br`, `bl` : un coin coupé en biais), `borderWidth`, `borderColor`, `borderOpacity`, `shadow` (`none`, `soft`, `strong`).

### `text` — un texte fixe, et `value` — une valeur en direct

Typographie pour les deux : `font` (`Unbounded`, `Onest`, `Barlow Condensed`, `Archivo` : les polices livrées avec RL-UI), `size` (6–400), `weight` (100–900), `italic`, `upper`, `spacing`, `color`, `align` (`left`, `center`, `right`), `valign` (`top`, `middle`, `bottom`), `shadow` (`none`, `soft`, `outline`), `fit` (`true` : le texte rétrécit s'il dépasse la largeur de l'élément, utile pour un titre d'alerte ou un pseudo).

- `text` ajoute `text` (80 caractères).
- `value` ajoute `bind`, et `prefix` / `suffix` facultatifs (12 caractères chacun).

| `bind` | Affiche |
| --- | --- |
| `wins`, `losses`, `record` | Victoires, défaites de la session, ou les deux (« 12 - 5 ») |
| `winRate` | Winrate de la session |
| `streak`, `bestStreak` | Série en cours, meilleure série de victoires |
| `otRecord` | Victoires-défaites en overtime |
| `mmr`, `mmrDelta` | MMR actuel, variation depuis le début de la session |
| `played`, `mvps` | Parties jouées, MVP |
| `labelWin`, `labelLoss` | Les lettres V / D choisies dans RL-UI |
| `mode`, `clock`, `score` | Compteur, pendant une partie : mode de jeu, chrono, score |
| `alertTitle`, `alertDetail` | Alertes : le titre (« VICTOIRE », « SÉRIE DE 3 »…, ou celui que tu as écrit dans RL-UI) et la ligne du dessus (mode de jeu, « But en or »…) |
| `matchScore`, `matchMmr`, `matchOt` | Alertes : score de la partie, variation de MMR de la partie (« ≈ » devant une estimation), durée de l'overtime |
| `timePlayed`, `player` | Récap : temps de jeu de la session, pseudo |
| `goals`, `assists`, `saves`, `goalDiff` | Récap : buts, passes, arrêts, différence de buts |

Les valeurs de la session (les six premières lignes) existent dans tous les overlays. Dans une alerte, `wins`, `losses`, `record` et `streak` sont ceux du moment de l'alerte.

### `image`

`src` (un chemin dans le dossier du thème, comme `images/logo.png`), `fit` (`contain`, `cover`, `fill`), `radius`. Un thème ne peut afficher que ses propres images : toute adresse qui pointe ailleurs est retirée.

### `results` — les dernières parties, en pastilles

`count` (1–20), `gap`, `radius`, `letters` (afficher V / D dans les pastilles), `dir` (`row`, `column`), `font`, `weight`.

### `bar` — la barre victoires / défaites

`radius`, `gap`, `dir`, `colorWin`, `colorLoss`.

## Ce qui arrive à tout le reste

RL-UI n'affiche jamais un fichier de thème tel quel. Il le ramène d'abord à ce que le format permet : les propriétés inconnues sont retirées, les valeurs hors limites ramenées dans les limites, les éléments d'un type inconnu supprimés. C'est le même code qui le fait dans l'éditeur, à l'installation d'un `.zip`, à l'arrivée d'un thème dans la galerie, et encore quand RL-UI installe un thème de la galerie.

Un thème qu'il a fallu corriger ainsi est **refusé par la galerie** : son auteur ne verrait pas ce qu'il croit avoir publié. Ouvrir le thème dans l'éditeur et l'enregistrer répare le fichier.

## Les contrôles avant de partager

Le bouton **Proposer** d'un thème (Overlays → Thèmes) les lance et dit quoi corriger :

- le compteur a au moins un élément (les autres overlays sont facultatifs) ; l'auteur et la description sont remplis ;
- `preview.png` existe (l'éditeur le fabrique à l'enregistrement) ;
- uniquement des fichiers permis, chacun sous 2 Mo, 8 Mo et 24 fichiers au total ;
- chaque image utilisée est dans le dossier, et c'est une vraie image ;
- pas de fichier son (pas encore accepté dans la galerie).

## Versions et compatibilité

- **Version du thème** : pour mettre à jour un thème publié, republie-le avec une `version` plus élevée. Ceux qui l'ont installé se voient proposer la mise à jour dans leur galerie.
- **`minApp`** : un thème fait aujourd'hui demande RL-UI 2.0.0. Quand un futur RL-UI ajoutera des types d'élément ou des propriétés, les thèmes qui s'en servent demanderont cette version, et les apps plus anciennes les afficheront comme « demande RL-UI x.y » au lieu de mal les dessiner.
- **`format`** : reste `2` tant que les anciens thèmes continuent de fonctionner sans changement.

## La galerie

La galerie est à l'adresse <https://kydora.net/marketplace>. RL-UI lit sa liste dans Overlays → **Galerie** ; chaque thème y vient avec la taille et l'empreinte SHA-256 de chacun de ses fichiers, et RL-UI n'installe rien qui ne corresponde pas, puis refait lui-même les contrôles ci-dessus. La publication se fait sur le site, avec le `.zip` exporté par le bouton **Proposer**.
