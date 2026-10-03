# Creating an RL-UI theme

**English** · [Français](THEMES.fr.md)

A theme changes the look of **every overlay** (counter, alerts, recent matches, recap, caster): colors, images, font and sounds. No coding needed: most themes only take two images and three colors.

> [!TIP]
> The easiest way: in RL-UI, **OBS overlays → Themes → Customize** on the **“Template (with images)”** theme. An editable copy is created and its folder opens. Every time you save a file, the overlays update **live**, even in OBS.

## What's in a theme

```text
my-theme/
├── theme.json        # name, author, colors, sounds   (required)
├── theme.css         # your styling                   (optional)
├── preview.png       # thumbnail shown in RL-UI       (optional, 480 × 120 recommended)
├── images/           # .png .jpg .webp .gif .svg
├── fonts/            # .woff2 .woff .ttf .otf
└── sounds/           # .mp3 .wav .ogg
```

Custom themes live in RL-UI's data folder (`%APPDATA%\RL-UI\themes`, **Open themes folder** button).

## theme.json

```json
{
  "name": "My look",
  "author": "Your name",
  "version": "1.0.0",
  "description": "One sentence describing the theme.",
  "colors": { "win": "#35e0ff", "loss": "#ff5470", "ot": "#ffc23d" },
  "sounds": { "win": "sounds/victory.mp3", "overtime": "sounds/ot.mp3" }
}
```

| Field | Purpose |
| --- | --- |
| `colors` | Win / loss / overtime colors, as `#rrggbb`. Used everywhere (numbers, glows, confetti). Can be turned off in RL-UI (“Use the theme's colors”). |
| `translations` | Optional: name and description in another language, e.g. `"translations": { "fr": { "name": "Ma DA", "description": "…" } }`. |
| `sounds` | Alert sounds. Types: `win`, `loss`, `overtime`, `ot_win`, `ot_loss`, `streak`. A custom sound picked in RL-UI still takes priority. |

## theme.css

`theme.css` is loaded **after** the original style: only write what you want to change. `url(...)` paths are relative to the theme folder.

### Variables

| Variable | Purpose |
| --- | --- |
| `--win`, `--loss`, `--ot` | Colors (already filled from `theme.json`) |
| `--font` | Overlay font |
| `--plate`, `--plate-line`, `--cut` | Overlay plates: background color, thin rules between cells, size of the 45° cut corners |
| `--s` | Scale (size set in RL-UI): `calc(40px * var(--s))` |

```css
@font-face { font-family: 'MyFont'; src: url('fonts/my-font.woff2'); }
:root { --font: 'MyFont'; }
```

### Targeting an overlay

Each page has a class on `<body>`: `.ov-counter`, `.ov-alerts`, `.ov-history`, `.ov-summary`, `.ov-caster`. The active theme also adds `.pack-<id>`.

### Elements you can change

**Counter** (`.ov-counter`)

| Selector | Element |
| --- | --- |
| `.w` | The whole counter (horizontal and vertical layouts) |
| `.theme-arena` / `.theme-broadcast` / `.theme-minimal` | The style picked in RL-UI; `::before` = top stripe |
| `.cell.win .num`, `.cell.loss .num`, `.lbl` | W / L numbers and their letters |
| `.st`, `.st b`, `.st i` | Stat boxes (winrate, streak, OT, MMR), value, label |
| `.otbadge` | “OVERTIME” badge during overtime |
| `.boost`, `.bfill`, `.brim` | “Boost” layout (next to the gauge) |
| `.deco` | **Free slot for a background image** (in `.w` and `.boost`) |

**Alerts** (`.ov-alerts`)

| Selector | Element |
| --- | --- |
| `.al` + `.t-win`, `.t-loss`, `.t-overtime`, `.t-ot_win`, `.t-ot_loss`, `.t-streak` | An alert, by type |
| `.kicker` | Small line above (game mode) |
| `.title .tx` | The big title |
| `.chip`, `.chip.hl`, `.chip.mmr` | Pills under the title (score, MMR, streak…) |
| `.art` | **Free slot for an image** (logo, mascot), centered on the alert |

**Caster** (`.ov-caster`)

The caster overlay can use **a different theme** from the other overlays: *Caster* tab → *Display* → *Look (theme)*.

| Selector | Element |
| --- | --- |
| `.bug`, `.bug .team.c0` / `.c1`, `.bug .score`, `.bug .clock` | Scorebug (`.clock.ot` in overtime, `.clock.replay` during a replay) |
| `.pips i.on` | Games won in the series |
| `.boosts .pl`, `.pl.tgt`, `.pl.dead`, `.pl .bar i` | Player boost (spectated player, demolished) |
| `.target` | Spectated player card |
| `.goal .tag` | Goal banner |
| `.feed .it` | Statfeed |
| `.post .card` | End-of-match scoreboard |
| `.bug .row > .deco` | **Free slot for an image** behind the scorebug |
| `.bug > .art` | **Free slot for an image** under the scorebug (tournament logo): give it a size and a background |
| `.post > .deco` | **Free slot for an image** behind the end-of-match scoreboard (full screen) |
| `--blue`, `--orange` | Team colors (sent by the game); `--tc` = the element's team color. Setting them on `.ov-caster` forces your own colors |
| `--panel`, `--line`, `--gold`, `--clock` | Plate background, thin rules, accent color (overtime, MVP, winner), clock background |
| `--round` | Corner rounding: `0` = square, `1` = normal |
| `--bug-shadow` | Scorebug shadow (`none` to remove it) |

```css
/* Caster: square corners, tournament logo under the scorebug */
.ov-caster { --round: 0; }
.ov-caster .bug > .art {
  width: calc(110px * var(--s)); height: calc(110px * var(--s));
  background: url('images/logo.png') center / contain no-repeat;
}
```

**Recent matches** (`.ov-history`): `.bar`, `.pill`, `.ttl`, `.deco`.
**Session recap** (`.ov-summary`): `.card`, `.big b`, `.tile`, `.pill`, `.deco`.

### Examples

```css
/* Counter background image */
.ov-counter .w .deco { background: url('images/background.png') center / cover; }
.ov-counter .theme-arena { background: transparent; }

/* Logo above victory alerts only */
.ov-alerts .al.t-win .art {
  width: calc(160px * var(--s)); height: calc(160px * var(--s));
  top: 0; transform: translate(-50%, -105%);
  background: url('images/logo.png') center / contain no-repeat;
}

/* Grey title for defeats */
.ov-alerts .al.t-loss .title .tx { color: #9aa3b2; }
```

## Sharing a theme

- **Export** (in RL-UI) creates a `.zip` of the theme.
- Others click **Install a theme (.zip)**: that's it.
- Reinstalling a theme with the same name updates the custom copy; built-in themes are never overwritten.

## Security

A theme can't contain **any script**: only the files listed above are accepted, anything else (`.js`, `.html`, `.exe`…) is ignored on install. Files are served with a strict security policy: a theme can neither run code nor load anything from the Internet.
