# Changelog

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
