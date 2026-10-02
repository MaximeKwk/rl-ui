# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.
Report it privately through GitHub: **Security → Report a vulnerability** on this repository, or open a minimal issue asking to be contacted, without details.

Include the RL-UI version (Settings → Application), what you did and what happened. You will get an answer as soon as possible; fixes ship through the in-app automatic update.

## Supported versions

Only the latest release receives security fixes. The installed version updates itself; the portable version shows a download link when a new version is available.

## How RL-UI protects you

- **Local only.** The overlay server listens on `127.0.0.1`. It is reachable from other devices only if you turn on *Reachable from the local network*.
- **Dashboard and actions are protected.** The dashboard opens only on the PC running RL-UI, and every action (add a win, change settings, Stream Deck URLs) needs a random key stored on your PC.
- **Websites can't read your data.** The live feed only accepts RL-UI's own pages (overlays and dashboard); a website open in your browser is refused, and requests with an unexpected `Host` are rejected (DNS rebinding).
- **Themes can't run code.** Only images, fonts, sounds and CSS are accepted from a theme `.zip`; files are served with a strict Content Security Policy and can't load anything from the Internet.
- **No mods, no telemetry.** RL-UI only reads Rocket League's official Stats API and the game's local log file. Nothing is sent over the Internet except the update check (GitHub) and the chat services you connect yourself (Twitch).
- **Desktop app hardening.** The window runs with context isolation and sandboxing; external links open in your browser, and only a short list of sites can be opened from the app.

## Known limitations

- The `.exe` is not code-signed yet (Windows SmartScreen may warn on first launch). The Microsoft Store version will be signed by Microsoft.
- OBS / Streamlabs passwords and the Twitch login are stored in RL-UI's data folder (`%APPDATA%\RL-UI`) in plain text, readable by programs running under your Windows account.
- In *Reachable from the local network* mode, overlays and API calls use plain HTTP on your network.
