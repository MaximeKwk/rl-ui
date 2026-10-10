# Changelog

## 2.0.0-beta.1

RL-UI V2, in beta on the `v2` branch.

- **New identity**: one look for the whole app (turquoise and violet, Unbounded and Onest), light and dark themes following your system, a guided home page, a collapsible icon menu, help bubbles. Three new built-in themes: Signature, Minimal, Contrast.
- **Reliability**: every match now ends with a decision and its reason (counted, tracking paused, mode excluded, no winner, left early…). Coming back into a match you left corrects the result instead of counting it twice. New **Diagnostic** page: health check of each link (game, API, log, account, MMR, overlays), every match seen with the reason it was counted or not and a button to count it anyway, and a report to copy that holds no personal data.
- **Statistics**: the History tab becomes **Stats**. Overview of a period by game mode, MMR curve, streaks, win rate after a win or a loss, sessions compared with each other or with your average, a session summary as an image to share, CSV export.
- **Easier to set up**: **Add to OBS** on every overlay (one click once OBS is connected, or drag the button into OBS), a search box that finds any setting, settings sorted into three panes, a rebuilt Help page.
- **Theme editor**: create a theme with the mouse. Plates, texts, live values, images, last matches, win/loss bar; layers, alignment, undo/redo, preview in each match situation. A theme draws the counter and, if you want, the alerts (one design, with elements shown per event: win, loss, overtime, streak, MVP), the recent matches and the session recap. Themes made this way are data only: no CSS, no script (see docs/THEME-FORMAT.md).
- **Community gallery**: *Overlays → Gallery* lists the themes published on kydora.net/marketplace, with search, styles, favorites, likes, install counts, compatibility and a live preview. Every file is checked before it is installed. The **Share** button checks your theme and exports it for publishing; **Install in RL-UI** links on the website open the app on the theme (`rlui://`).

Not changed: the "Boost" counter keeps its look with every theme.

## 1.2.5

- **MMR estimate**: before RL-UI knows any real MMR value for you (for example when your party leader always starts the search), a match is now estimated at **±10** instead of ±12, closer to a real ranked match. Existing estimated matches are recalculated; real values don't change.

## 1.2.4

- **Themes for caster mode**: the caster overlay can use its own theme (Caster tab → Display → Look), or the same one as the other overlays.
- Built-in themes now style the caster overlay too: Neon (glowing outlines in the team colors), Gold & Black (square black plates, gold trim), and the Template shows a background image behind the scorebug, a tournament logo under it and an image behind the final scoreboard.
- New theme variables for the caster (`--round`, `--clock`, `--bug-shadow`) and free image slots; see docs/THEMES.md.

## 1.2.3

- **Twitch has its own tab** in the dashboard (connection, commands, cooldown).
- Chat commands are answered only in the channel of the connected Twitch account; the “Channel” field is gone.

## 1.2.2

- **New default alert sounds**, in a modern video game style: riser, impact and big synth chords. Shorter (1–2 s) and balanced with each other (the win streak sound is now clearly audible). Your own sounds and theme sounds still replace them.

## 1.2.1

- **New logo**: a TV-graphics plate with cut corners, upright “RL” and the two team colors, matching the new design (app icon, taskbar, Microsoft Store tiles).
- New GitHub banner.

## 1.2.0

- **New dashboard design**: a broadcast control-desk look (matte surfaces, readouts for numbers, status lights), a clearer settings page, Archivo font for the interface.
- **New stream overlays**: TV-style graphics (opaque plates with 45° cut corners, upright numbers, solid colors). Alerts are now a broadcast banner, with no more glows, rays, glitch or confetti. Built-in themes updated; new theme variables `--plate`, `--plate-line`, `--cut`.
- **Security**: passwords (OBS, Streamlabs) and the Twitch login are encrypted with Windows data protection, and websites open in your browser can no longer read RL-UI's live feed. See SECURITY.md.
- Switching tabs now starts at the top of the page.

## 1.1.2

- **MMR**: the real change after a match is now given to the right match. A match that ended more than 3 minutes before you queue again is always counted in the new value; only the one that just ended can still be missing (server delay).
- When your MMR moved much more than your tracked matches explain (matches played without RL-UI), RL-UI no longer puts the whole difference on one match: those matches keep their estimate (≈).
- Your existing history is recalculated with these rules on first launch.

## 1.1.1

- **Caster mode — statfeed**: plays (demolitions, saves, epic saves, hat tricks…) now show **one at a time** in the bottom-left corner, instead of piling up and disappearing together.
- Demolitions and saves are also detected from the players' stats when the game doesn't send its own statfeed.
- Checked against a real recorded Rocket League match.

## 1.1.0

- **Automatic updates**: the installed version downloads new versions in the background and offers “Restart to install” (the portable version shows a download link).
- **Twitch chat commands**: `!wl`, `!mmr`, `!last`, `!streak`, `!ot` and your own commands, answered in your chat with live stats. Login with a code on twitch.tv/activate, no bot to install.
- **Caster mode**: team logos and player photos (scorebug, spectated player card, final scoreboard).
- **Guided setup** on first launch: language, Rocket League connection, overlays in OBS, look (reopen it from Help).
- **Microsoft Store** package (signed by Microsoft once published), privacy policy.
- Installer in English and French.

## 1.0.0 — first public release

- **Automatic tracking** of wins, losses, overtimes, early leaves and forfeits through Rocket League's official Stats API (no mods, EAC-compatible).
- **Real MMR** read from the game log, with an instant estimate at the end of the match corrected automatically (+x in green, −x in red).
- **Overlays** for OBS and Streamlabs: counter (horizontal, vertical or next to the boost gauge), animated alerts with sounds (victory, defeat, overtime, OT won / lost, win streaks), recent matches, session recap.
- **Automatic actions** in OBS Studio or Streamlabs Desktop (show a source, switch scene).
- **Themes**: Classic, Neon, Gold & Black and a template with images; live customization (images, font, colors, sounds), install and share as .zip (see docs/THEMES.md).
- **Caster mode**: broadcast overlay for casting as a spectator (scorebug, Bo1 to Bo7 series counted automatically, every player's boost, spectated player, goal banner, statfeed, end-of-match scoreboard) with its own tab.
- **Languages**: app and overlays in English by default, French available (Settings → Language · Langue).
- **Stream Deck** URLs, global hotkeys, text files, full history.

## Betas (before 1.0.0)

- 0.3 beta: vertical and “Boost” layouts, Streamlabs actions, preparation for distribution.
- 0.2 beta: real MMR.
- 0.1 beta: first internal version (codename “Overtime Tracker”).
