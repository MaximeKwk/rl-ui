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
| `boost`, `alerts`, `history`, `summary`, `caster` | Facultatifs : la composition du compteur « Boost », des alertes, des dernières parties, du récap de session et de l'overlay caster. |

Un thème composé dessine toujours le **compteur**. Il peut aussi dessiner le **compteur « Boost »** (celui qui se colle à la jauge de boost du jeu), les **alertes**, les **dernières parties**, le **récap de session** et l'**overlay caster**. Ceux qu'il ne dessine pas gardent l'habillage `base` ; le compteur « Boost », lui, garde alors l'habillage de RL-UI, le même avec tous les thèmes.

## La composition

Une composition est une toile (`width` 40–1920, `height` 20–1080, en pixels) et jusqu'à 120 `elements`, dessinés dans l'ordre (le dernier au-dessus). Les overlays partagent les mêmes éléments de base ; changent les valeurs en direct, les conditions, et quelques éléments propres au caster.

| Composition | Toile proposée | Remarques |
| --- | --- | --- |
| `counter` | 1000 × 220 | La taille de la source OBS. |
| `boost` | 480 × 320 | La toile est posée dans le **coin bas droit** d'un écran 1920 × 1080 : la jauge de boost du jeu y a son centre à 156 px du bord droit et 150 px du bas (rayon 118). Le calibrage Boost de RL-UI (taille, position) s'y applique. `gaugeGap` (0–80), s'il est présent, découpe tout ce qui est à moins de cet écart de la jauge : une plaque posée dessous épouse alors la jauge. |
| `alerts` | 1920 × 1080 | Une seule composition pour toutes les alertes : les conditions `alert…` disent quels éléments apparaissent pour quelle alerte. La toile est ajustée et centrée dans la source. `enter` choisit l'entrée en scène : `slide`, `rise`, `pop`, `fade` ou `none`. |
| `history` | 700 × 90 | La taille de la source OBS. |
| `summary` | 1920 × 1080 | La toile est ajustée et centrée dans la source. |
| `caster` | 1920 × 1080 | Une seule composition pour tout l'overlay : chaque bloc (tableau des scores, boost des joueurs, joueur suivi, bannière de but, action, tableau final) est fait des éléments qui portent sa condition. Les cases de l'onglet Caster et `?hide=` dans l'adresse de l'overlay masquent toujours les blocs. |

Chaque élément a :

| Champ | Valeurs |
| --- | --- |
| `type` | `box`, `text`, `value`, `image`, `results`, `bar`, `arc` ; dans le caster `players`, `pips`, `board` à la place de `results` et `bar` |
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
| `overtime`, `replay`, `ended` | en overtime, pendant le ralenti d'un but, quand la partie est finie | caster |
| `series` | quand une série (ou un titre) est réglée dans l'onglet Caster | caster |
| `boosts`, `target`, `goal`, `feed`, `post` | les blocs : boost des joueurs, joueur suivi, bannière de but, action du statfeed, tableau final | caster |

`match`, `idle`, `overtime`, `winStreak`, `lossStreak` et `mmr` valent aussi pour le compteur « Boost ». Un élément apparaît et disparaît en fondu quand sa condition change.

L'éditeur ne propose pour chaque overlay que les conditions de sa ligne. Une condition écrite à la main dans un autre overlay ne casse rien, mais n'y a pas de sens.

Une couleur est un `#rrggbb` ou l'un de ces noms : `win`, `loss`, `ot` (les couleurs du thème), `white`, `black`, pour les valeurs en direct `auto` (la couleur de victoire en hausse, celle de défaite en baisse, doré en série de victoires, bleu en série de défaites), et dans les alertes `event` : la couleur de l'alerte affichée (victoire, défaite, ou overtime pour un début d'overtime et une série). Le compteur « Boost » a `team` : la couleur de ton équipe pendant une partie, comme la jauge du jeu. Le caster a `team0` et `team1` (équipe bleue, équipe orange, aux couleurs envoyées par le jeu) et `event` : l'équipe concernée par l'élément selon sa condition (`target` : celle du joueur suivi, `goal` : celle du buteur, `feed` : celle de l'action, `post` et `ended` : le vainqueur).

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

Dans le caster, les valeurs sont celles de la partie observée :

| `bind` (caster) | Affiche |
| --- | --- |
| `teamName0`, `teamName1`, `teamScore0`, `teamScore1` | Nom et score de l'équipe bleue, de l'équipe orange |
| `matchClock`, `clockNote` | Le chrono, et ce qui s'écrit dessous : ralenti, overtime, final |
| `seriesLine`, `seriesTitle`, `seriesInfo`, `seriesWins0`, `seriesWins1` | Le titre et la série sur une ligne, ou séparément ; les manches gagnées |
| `tgName`, `tgTeam`, `tgBoost`, `tgScore`, `tgGoals`, `tgAssists`, `tgSaves`, `tgShots`, `tgDemos` | Le joueur suivi par la caméra |
| `goalScorer`, `goalAssist`, `goalSpeed` | Le but affiché : buteur, passeur, vitesse du tir (km/h ou mph selon l'onglet Caster) |
| `feedLabel`, `feedText` | L'action du statfeed affichée : son nom, les joueurs |
| `finalScore`, `winnerLine` | Fin de partie : le score, « VICTOIRE DE … » |

Les valeurs de la session (les six premières lignes du premier tableau) existent dans tous les overlays sauf le caster. Dans une alerte, `wins`, `losses`, `record` et `streak` sont ceux du moment de l'alerte.

### `image`

`src` (un chemin dans le dossier du thème, comme `images/logo.png`), `fit` (`contain`, `cover`, `fill`), `radius`. Un thème ne peut afficher que ses propres images : toute adresse qui pointe ailleurs est retirée.

Dans le caster, `bind` remplace `src` par une image fournie par RL-UI (onglet Caster) : `teamLogo0`, `teamLogo1` (logos des équipes) ou `tgPhoto` (photo du joueur suivi). Quand RL-UI n'en a pas, l'élément montre l'image du thème donnée par `src` s'il y en a une ; sinon une silhouette de la couleur de l'équipe pour `tgPhoto`, et rien pour un logo. Le thème ne choisit toujours aucune adresse.

### `results` — les dernières parties, en pastilles

`count` (1–20), `gap`, `radius`, `letters` (afficher V / D dans les pastilles), `dir` (`row`, `column`), `font`, `weight`.

### `bar` — la barre victoires / défaites

`radius`, `gap`, `dir`, `colorWin`, `colorLoss`.

### `arc` — un arc de cercle, des graduations ou une jauge

L'arc est inscrit dans le rectangle de l'élément. `from` et `to` (degrés, 0 en haut, dans le sens des aiguilles d'une montre ; 0 → 360 pour un cercle), `thickness`, `color`, `cap` (`butt`, `round`), `ticks` (0 : un trait continu ; sinon ce nombre de graduations, larges de `tickW`). Avec `bind` (`winRate`, ou `tgBoost` dans le caster), l'arc se remplit selon la valeur, de 0 à 100 ; `track` (0–1) est l'opacité du reste de l'arc.

### Éléments du caster

- **`players`** — les joueurs d'une équipe et leur boost, une ligne par joueur : `team` (0 bleue, 1 orange), `side` (`left`, `right`), `rowH`, `gap`, `fill`, `fillOpacity`, `radius`, `stripe` (liseré de la couleur de l'équipe), `barH` (0 : pas de barre), `font`, `weight`, `size`, `color`. Le joueur suivi est entouré, un joueur démoli estompé.
- **`pips`** — les manches gagnées d'une équipe, autant de cases que de manches à gagner : `team`, `gap`, `radius`, `skew`, `color`.
- **`board`** — le tableau des joueurs en fin de partie (score, buts, passes, arrêts, tirs, démos ; MVP et photos) : `rowH`, `stripe`, `lines`, `header`, `fill`, `fillOpacity`, `font`, `weight`, `size`, `color`.

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
