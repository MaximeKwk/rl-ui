# Composed themes: the format (format 2)

**English** · [Français](THEME-FORMAT.fr.md)

A composed theme is what the **theme editor** produces (Overlays → Themes → Create a theme) and the only kind of theme the **community gallery** accepts. It is described entirely by data: a canvas and elements placed on it. It contains **no CSS and no script**, so installing someone else's theme cannot run anything on your PC.

You never have to write this file by hand: the editor does it. This page is the reference for people who want to understand, generate or check a theme.

> Themes with a style sheet (`theme.css`, format 1) still work in RL-UI and are documented in [THEMES.md](THEMES.md). They cannot be published in the gallery.

## The folder

```text
my-theme/
├── theme.json        # the theme (required)
├── preview.png       # thumbnail, made by the editor when you save (required for the gallery)
├── images/           # .png .jpg .webp .gif used by the theme
└── README.md         # optional
```

Nothing else is allowed in the folder. Images are recognized by their content, not their name; `.svg` files are refused.

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

| Field | Meaning |
| --- | --- |
| `format` | Always `2`. |
| `name` | 60 characters at most. Required. |
| `author`, `description` | 60 and 300 characters at most. Required for the gallery. |
| `version` | `major.minor.patch`. An update must have a higher version than the one published. |
| `tags` | Up to 5 among `minimal`, `competitive`, `neon`, `dark`, `light`, `colorful`, `retro`, `esport`, `compact`, `vertical`. |
| `minApp` | The oldest RL-UI version that can display the theme. The gallery does not let an older RL-UI install it. |
| `colors` | Win / loss / overtime colors, `#rrggbb`. Used by the `win`, `loss`, `ot` color names below, and by the alerts. |
| `base` | Look of the overlays the theme does not draw itself: `signature`, `epure` or `contraste`. |
| `translations` | Optional name and description in `en` or `fr`. |
| `counter` | The composition of the W/L counter (below). Required for the gallery. |
| `boost`, `alerts`, `history`, `summary`, `caster` | Optional: the composition of the "Boost" counter, the alerts, the recent matches, the session recap and the caster overlay. |

A composed theme always draws the **counter**. It can also draw the **"Boost" counter** (the one that sticks to the game's boost gauge), the **alerts**, the **recent matches**, the **session recap** and the **caster overlay**. The ones it does not draw keep the `base` look; the "Boost" counter then keeps RL-UI's own look, the same with every theme.

## The composition

A composition is a canvas (`width` 40–1920, `height` 20–1080, in pixels) and up to 120 `elements`, drawn in order (the last one on top). The overlays share the same basic elements; what differs is the live values, the conditions, and a few elements of the caster only.

| Composition | Suggested canvas | Notes |
| --- | --- | --- |
| `counter` | 1000 × 220 | The size of the OBS source. |
| `boost` | 480 × 320 | The canvas sits in the **bottom right corner** of a 1920 × 1080 screen: the game's boost gauge has its center 156 px from the right edge and 150 px from the bottom (radius 118). RL-UI's Boost calibration (size, position) applies to it. `gaugeGap` (0–80), when present, cuts out everything closer than this gap to the gauge: a plate placed under it then hugs the gauge. |
| `alerts` | 1920 × 1080 | One composition for every alert: the `alert…` conditions say which elements appear for which alert. The canvas is fitted and centered in the source. `enter` picks the entrance: `slide`, `rise`, `pop`, `fade` or `none`. |
| `history` | 700 × 90 | The size of the OBS source. |
| `summary` | 1920 × 1080 | The canvas is fitted and centered in the source. |
| `caster` | 1920 × 1080 | One composition for the whole overlay: each block (scorebug, players' boost, followed player, goal banner, action, final scoreboard) is made of the elements carrying its condition. The checkboxes of the Caster tab and `?hide=` in the overlay address still hide the blocks. |

Every element has:

| Field | Values |
| --- | --- |
| `type` | `box`, `text`, `value`, `image`, `results`, `bar`, `arc`; in the caster `players`, `pips`, `board` instead of `results` and `bar` |
| `id` | Lowercase letters and digits, unique. Given automatically if missing. |
| `name` | Layer name shown in the editor (40 characters). |
| `x`, `y`, `w`, `h` | Position and size in pixels. |
| `rotate` | −180 to 180 degrees. |
| `opacity` | 0 to 1. |
| `when` | When the element is visible: `always` or one of the conditions below. |
| `hidden` | `true` to keep the element in the theme without showing it. |

| `when` | Visible… | Overlays |
| --- | --- | --- |
| `match`, `idle`, `overtime` | during a match, between matches, in overtime | counter |
| `winStreak`, `lossStreak` | from 2 wins (or losses) in a row | counter, recent matches, recap; `winStreak` in alerts too |
| `mmr` | when the MMR is known | counter, recent matches, recap |
| `alertWin`, `alertLoss` | for a win, a loss (overtime included) | alerts |
| `alertOt` | when overtime starts | alerts |
| `alertOtEnd` | for an overtime win or loss | alerts |
| `alertStreak` | for a win streak | alerts |
| `alertMvp` | when the win comes with the MVP | alerts |
| `matchScore`, `matchMmr` | when the score, or the MMR change of the match, is known | alerts |
| `overtime`, `replay`, `ended` | in overtime, during a goal replay, when the match is over | caster |
| `series` | when a series (or a title) is set in the Caster tab | caster |
| `boosts`, `target`, `goal`, `feed`, `post` | the blocks: players' boost, followed player, goal banner, statfeed action, final scoreboard | caster |

`match`, `idle`, `overtime`, `winStreak`, `lossStreak` and `mmr` also apply to the "Boost" counter. An element fades in and out when its condition changes.

For each overlay the editor only offers the conditions of its row. A condition written by hand in another overlay breaks nothing, but means nothing there.

Colors are `#rrggbb` or one of: `win`, `loss`, `ot` (the theme's colors), `white`, `black`, for live values `auto` (the win color when rising, the loss color when falling, gold on a win streak, blue on a losing streak), and in alerts `event`: the color of the alert being shown (win, loss, or overtime for an overtime start and a streak). The "Boost" counter has `team`: your team's color during a match, like the game's gauge. The caster has `team0` and `team1` (blue team, orange team, in the colors sent by the game) and `event`: the team the element is about, according to its condition (`target`: the followed player's, `goal`: the scorer's, `feed`: the action's, `post` and `ended`: the winner).

### `box` — a plate

`fill`, `fillOpacity`, `radius` (rounded corners), `cut` and `cutCorner` (`tr`, `tl`, `br`, `bl`: one corner cut at an angle), `borderWidth`, `borderColor`, `borderOpacity`, `shadow` (`none`, `soft`, `strong`).

### `text` — fixed text, and `value` — a live value

Typography for both: `font` (`Unbounded`, `Onest`, `Barlow Condensed`, `Archivo`: the fonts shipped with RL-UI), `size` (6–400), `weight` (100–900), `italic`, `upper`, `spacing`, `color`, `align` (`left`, `center`, `right`), `valign` (`top`, `middle`, `bottom`), `shadow` (`none`, `soft`, `outline`), `fit` (`true`: the text shrinks when it is wider than the element, handy for an alert title or a player name).

- `text` adds `text` (80 characters).
- `value` adds `bind`, and optional `prefix` / `suffix` (12 characters each).

| `bind` | Shows |
| --- | --- |
| `wins`, `losses`, `record` | Session wins, losses, or both ("12 - 5") |
| `winRate` | Win rate of the session |
| `streak`, `bestStreak` | Current streak, best win streak |
| `otRecord` | Overtime wins-losses |
| `mmr`, `mmrDelta` | Current MMR, change since the session started |
| `played`, `mvps` | Matches played, MVPs |
| `labelWin`, `labelLoss` | The W / L letters chosen in RL-UI |
| `mode`, `clock`, `score` | Counter, during a match: game mode, clock, score |
| `alertTitle`, `alertDetail` | Alerts: the title ("VICTORY", "3 WIN STREAK"…, or the one you wrote in RL-UI) and the line above it (game mode, "Golden goal"…) |
| `matchScore`, `matchMmr`, `matchOt` | Alerts: score of the match, MMR change of the match ("≈" before an estimate), overtime length |
| `timePlayed`, `player` | Recap: time played in the session, player name |
| `goals`, `assists`, `saves`, `goalDiff` | Recap: goals, assists, saves, goal difference |

In the caster, the values are those of the match being watched:

| `bind` (caster) | Shows |
| --- | --- |
| `teamName0`, `teamName1`, `teamScore0`, `teamScore1` | Name and score of the blue team, of the orange team |
| `matchClock`, `clockNote` | The clock, and what is written under it: replay, overtime, final |
| `seriesLine`, `seriesTitle`, `seriesInfo`, `seriesWins0`, `seriesWins1` | Title and series on one line, or separately; games won in the series |
| `tgName`, `tgTeam`, `tgBoost`, `tgScore`, `tgGoals`, `tgAssists`, `tgSaves`, `tgShots`, `tgDemos` | The player followed by the camera |
| `goalScorer`, `goalAssist`, `goalSpeed` | The goal shown: scorer, assist, shot speed (km/h or mph, as set in the Caster tab) |
| `feedLabel`, `feedText` | The statfeed action shown: its name, the players |
| `finalScore`, `winnerLine` | End of match: the score, "… WINS" |

The session values (the first six rows of the first table) exist in every overlay except the caster. In an alert, `wins`, `losses`, `record` and `streak` are those at the time of the alert.

### `image`

`src` (a path inside the theme folder, such as `images/logo.png`), `fit` (`contain`, `cover`, `fill`), `radius`. A theme can only show its own images: addresses pointing anywhere else are dropped.

In the caster, `bind` replaces `src` with an image supplied by RL-UI (Caster tab): `teamLogo0`, `teamLogo1` (team logos) or `tgPhoto` (photo of the followed player). The element stays empty when there is none. The theme still chooses no address.

### `results` — the last matches, as pills

`count` (1–20), `gap`, `radius`, `letters` (show W / L in the pills), `dir` (`row`, `column`), `font`, `weight`.

### `bar` — the win / loss bar

`radius`, `gap`, `dir`, `colorWin`, `colorLoss`.

### `arc` — an arc, ticks or a gauge

The arc is inscribed in the element's rectangle. `from` and `to` (degrees, 0 at the top, clockwise; 0 → 360 for a full circle), `thickness`, `color`, `cap` (`butt`, `round`), `ticks` (0: a solid line; otherwise that many ticks, `tickW` wide). With `bind` (`winRate`, or `tgBoost` in the caster), the arc fills with the value, from 0 to 100; `track` (0–1) is the opacity of the rest of the arc.

### Caster elements

- **`players`** — a team's players and their boost, one row per player: `team` (0 blue, 1 orange), `side` (`left`, `right`), `rowH`, `gap`, `fill`, `fillOpacity`, `radius`, `stripe` (edge in the team's color), `barH` (0: no bar), `font`, `weight`, `size`, `color`. The followed player is outlined, a demolished player dimmed.
- **`pips`** — a team's wins in the series, as many cells as games needed to win it: `team`, `gap`, `radius`, `skew`, `color`.
- **`board`** — the end-of-match table of players (score, goals, assists, saves, shots, demos; MVP and photos): `rowH`, `stripe`, `lines`, `header`, `fill`, `fillOpacity`, `font`, `weight`, `size`, `color`.

## What happens to anything else

RL-UI never displays a theme file as it is. It first brings it back to what the format allows: unknown properties are dropped, values out of range are clamped, elements of an unknown type are removed. The same code does this in the editor, when a `.zip` is installed, when a theme arrives in the gallery, and again when RL-UI installs a gallery theme.

A theme that had to be corrected this way is **refused by the gallery**: its author would not see what they think they published. Opening the theme in the editor and saving it fixes the file.

## Checks before sharing

The **Share** button of a theme (Overlays → Themes) runs them and says what to fix:

- the counter has at least one element (the other overlays are optional); author and description are filled in;
- `preview.png` exists (the editor makes it when you save);
- only allowed files, each under 2 MB, 8 MB and 24 files in total;
- every image used is in the folder, and is a real image;
- no sound files (not accepted in the gallery yet).

## Versions and compatibility

- **Theme version**: to update a published theme, publish it again with a higher `version`. People who installed it are offered the update in their gallery.
- **`minApp`**: a theme made today asks for RL-UI 2.0.0. When a future RL-UI adds element types or properties, themes using them will ask for that version, and older apps will show them as "needs RL-UI x.y" instead of displaying them wrong.
- **`format`**: stays `2` as long as older themes keep working unchanged.

## The gallery

The gallery lives at <https://kydora.net/marketplace>. RL-UI reads its list in Overlays → **Gallery**; each theme comes with the size and SHA-256 fingerprint of every file, and RL-UI installs nothing that does not match, then runs the checks above itself. Publishing is done on the website, with the `.zip` exported by the **Share** button.
