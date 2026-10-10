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
  "counter": { "width": 1000, "height": 220, "elements": [] }
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
| `base` | Look of the overlays the theme does not draw itself (alerts, recent matches, recap): `signature`, `epure` or `contraste`. |
| `translations` | Optional name and description in `en` or `fr`. |
| `counter` | The composition of the W/L counter (below). |

A composed theme draws the **counter**. The "Boost" layout of the counter keeps its own look with every theme.

## The composition

`counter` is a canvas (`width` 40–1920, `height` 20–1080, in pixels: the size of the OBS source) and up to 80 `elements`, drawn in order (the last one on top).

Every element has:

| Field | Values |
| --- | --- |
| `type` | `box`, `text`, `value`, `image`, `results`, `bar` |
| `id` | Lowercase letters and digits, unique. Given automatically if missing. |
| `name` | Layer name shown in the editor (40 characters). |
| `x`, `y`, `w`, `h` | Position and size in pixels. |
| `rotate` | −180 to 180 degrees. |
| `opacity` | 0 to 1. |
| `when` | When the element is visible: `always`, `match` (during a match), `idle` (between matches), `overtime`, `winStreak` (2 wins in a row or more), `lossStreak`, `mmr` (when the MMR is known). |
| `hidden` | `true` to keep the element in the theme without showing it. |

Colors are `#rrggbb` or one of: `win`, `loss`, `ot` (the theme's colors), `white`, `black`, and for live values `auto` (the win color when rising, the loss color when falling, gold on a win streak, blue on a losing streak).

### `box` — a plate

`fill`, `fillOpacity`, `radius` (rounded corners), `cut` and `cutCorner` (`tr`, `tl`, `br`, `bl`: one corner cut at an angle), `borderWidth`, `borderColor`, `borderOpacity`, `shadow` (`none`, `soft`, `strong`).

### `text` — fixed text, and `value` — a live value

Typography for both: `font` (`Unbounded`, `Onest`, `Barlow Condensed`, `Archivo`: the fonts shipped with RL-UI), `size` (6–400), `weight` (100–900), `italic`, `upper`, `spacing`, `color`, `align` (`left`, `center`, `right`), `valign` (`top`, `middle`, `bottom`), `shadow` (`none`, `soft`, `outline`).

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
| `mode`, `clock`, `score` | During a match: game mode, clock, score |

### `image`

`src` (a path inside the theme folder, such as `images/logo.png`), `fit` (`contain`, `cover`, `fill`), `radius`. A theme can only show its own images: addresses pointing anywhere else are dropped.

### `results` — the last matches, as pills

`count` (1–20), `gap`, `radius`, `letters` (show W / L in the pills), `dir` (`row`, `column`), `font`, `weight`.

### `bar` — the win / loss bar

`radius`, `gap`, `dir`, `colorWin`, `colorLoss`.

## What happens to anything else

RL-UI never displays a theme file as it is. It first brings it back to what the format allows: unknown properties are dropped, values out of range are clamped, elements of an unknown type are removed. The same code does this in the editor, when a `.zip` is installed, when a theme arrives in the gallery, and again when RL-UI installs a gallery theme.

A theme that had to be corrected this way is **refused by the gallery**: its author would not see what they think they published. Opening the theme in the editor and saving it fixes the file.

## Checks before sharing

The **Share** button of a theme (Overlays → Themes) runs them and says what to fix:

- the counter has at least one element; author and description are filled in;
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
