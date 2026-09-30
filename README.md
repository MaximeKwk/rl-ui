# BoostSide

**Overlay de stream pour Rocket League** — créé par **Zoxam**.

*Stream overlay for Rocket League: automatic win/loss + MMR tracking, animated win / loss / overtime alerts, a counter that sits next to the boost meter. Interface in French.*

Compte tes victoires / défaites et ton MMR tout seul, et affiche sur ton stream des alertes animées :
**VICTOIRE**, **DÉFAITE**, **OVERTIME** (dès que la prolongation commence), **VICTOIRE / DÉFAITE EN OVERTIME**, **séries**.

- 100 % automatique grâce à la **Stats API officielle** de Psyonix : pas de BakkesMod, pas de mod, compatible anti-cheat (EAC).
- Reconnaît **ton** compte (Steam ou Epic) : marche en solo comme en duo / trio.
- Mode de jeu (2v2 classé, 3v3…), score, overtime, MVP, abandons, forfaits, **MMR réel** (+x / −x).
- Compteur **horizontal**, **vertical** ou **collé à la jauge de boost** du jeu.
- Actions automatiques dans **OBS Studio** ou **Streamlabs Desktop**, URLs **Stream Deck**, raccourcis clavier, fichiers texte.
- Tout reste sur ton PC : aucune donnée n'est envoyée sur Internet.

## Prérequis

- Windows 10 ou 11 (64 bits).
- Rocket League sur PC (Steam ou Epic Games).
- OBS Studio 28+ ou Streamlabs Desktop pour les overlays (n'importe quel logiciel avec une source « Navigateur » fonctionne).

## Installation

Télécharge `BoostSide-Setup-x.y.z.exe` (installation en un clic) ou `BoostSide-Portable-x.y.z.exe` (sans installation)
depuis les [Releases](https://github.com/MaximeKwk/boostside/releases), ou compile-le (voir *Développement*).

Windows peut afficher « Windows a protégé votre ordinateur » (application non signée) : *Informations complémentaires → Exécuter quand même*.
L'app vit dans la zone de notification (icône **B**) : fermer la fenêtre ne l'arrête pas, clic droit sur l'icône → *Quitter*.

## Mise en route

1. **Stats API de Rocket League** : activée d'office dans les versions récentes du jeu. Si le tableau de bord indique
   « Stats API : désactivée », clique sur *Réglages → Activer / réparer l'API* puis **redémarre Rocket League**.
2. **Joue.** Ton compte est lu dans le journal du jeu (`Documents\My Games\Rocket League\TAGame\Logs\Launch.log`), le reste
   arrive en direct par l'API (TCP `49123`, WebSocket `49124`).
3. **Ajoute les overlays** dans OBS ou Streamlabs : *Sources → + → Navigateur*, colle l'URL.

| Overlay | URL | Taille |
| --- | --- | --- |
| Compteur (horizontal) | `http://127.0.0.1:5757/overlay/counter` | 1000 × 220 |
| Compteur (vertical) | `http://127.0.0.1:5757/overlay/counter?layout=vertical` | 340 × 720 |
| Compteur « Boost » | `http://127.0.0.1:5757/overlay/counter?layout=boost` | plein écran (taille du canevas) |
| Alertes | `http://127.0.0.1:5757/overlay/alerts` | plein écran |
| Dernières parties | `http://127.0.0.1:5757/overlay/history` | 700 × 90 |
| Récap de session | `http://127.0.0.1:5757/overlay/summary` | plein écran |

Pour entendre les alertes sur le stream : propriétés de la source → **« Contrôler l'audio via OBS »**.
Sans paramètre, les overlays suivent les réglages du tableau de bord (disposition, thème, couleurs, textes…) en direct.

## Compteur : horizontal, vertical ou « Boost »

- **Horizontal / vertical** : thèmes *Arena*, *Broadcast* (style RLCS) ou *Minimal*.
- **Boost** : source en plein écran au-dessus de la capture du jeu. Le compteur se place tout seul **à gauche de la jauge de
  boost**, son bord droit suit l'arc de la jauge, et il prend **la couleur de ton équipe** (bleu / orange) comme la jauge.
  Si ton HUD n'a pas la même taille, active *Repère de la jauge* dans *Overlays → Compteur*, ajuste *Taille du HUD* et les
  décalages jusqu'à ce que le repère recouvre ta jauge dans OBS, puis désactive le repère.

Paramètres d'URL (optionnels) : `theme=arena|broadcast|minimal`, `layout=horizontal|vertical|boost`, `scale=1.3`,
`align=left|center|right`, `hide=wr,streak,ot,mmr`, `mmr=session|value|both`, `bscale`, `bx`, `by`, `guide=1`,
couleurs `win=2ef2a0&loss=ff4d6d&ot=ffb020`. Alertes : `pos=center|top|bottom`, `scale`, `mute=1`, `only=overtime,ot_win`, `mmr=0`.

## MMR

La Stats API ne donne pas le MMR, mais le journal du jeu si : à chaque recherche de partie lancée **depuis ton PC** (seul ou chef
de groupe), Rocket League y écrit ton MMR pour le mode choisi (`PartyLeaderMMR`, valeur TrueSkill μ ; MMR affiché = μ × 20 + 100).

- Ton MMR actuel est connu dès le lancement (lu dans les journaux des sessions précédentes).
- La variation exacte de chaque match arrive à la recherche suivante ; en attendant, une estimation basée sur tes vraies variations
  récentes est affichée (marquée « ≈ » dans le tableau de bord), puis remplacée automatiquement.
- Si c'est ton mate qui lance la recherche, ton jeu n'écrit rien : seule l'estimation est disponible pour ces parties.
- Affichage : « MMR » avec **+x en vert** ou **−x en rouge** (session), la valeur actuelle, ou les deux. Classé uniquement par défaut.

## Actions automatiques (OBS Studio ou Streamlabs Desktop)

Onglet *Actions stream* : pour chaque événement (overtime, victoire, défaite, OT gagné / perdu, série), **afficher une source**
pendant N secondes ou **changer de scène** avec retour automatique.

- **OBS Studio** 28+ : *Outils → Paramètres du serveur WebSocket* → activer, puis copier le mot de passe (port 4455).
- **Streamlabs Desktop** : *Paramètres → Contrôle à distance* → clic sur le QR code → *Afficher les détails* → copier le jeton de
  l'API (port 59650).

## Autres intégrations

- **Stream Deck** : action *Site web* + **« Accéder en arrière-plan »**, avec les URL de *Réglages → Stream Deck · API*
  (`/api/action/win?key=…`, `&alert=1` pour déclencher l'alerte). Marche aussi avec Streamer.bot, Touch Portal…
- **Raccourcis globaux** : `Ctrl+Alt+Shift+↑` +1 victoire, `Ctrl+Alt+Shift+↓` +1 défaite, `Ctrl+Alt+Shift+Retour arrière` annuler.
- **Fichiers texte** (source « Texte (GDI+) ») dans `%APPDATA%\BoostSide\texte` : `wins.txt`, `losses.txt`, `record.txt`,
  `winrate.txt`, `streak.txt`, `ot.txt`, `last.txt`, `mmr.txt`, `mmr-session.txt`, `custom.txt` (format personnalisable).
- **Texte par HTTP** : `http://127.0.0.1:5757/api/text/record` (aussi `wins`, `losses`, `winrate`, `streak`, `ot`, `mmr`, `mmrsession`, `summary`).

## Ce qui est compté

Par défaut : classé, occasionnel, modes extra et tournois (pas les parties privées ni le hors-ligne) — réglable.
Quitter une partie classée compte comme une défaite (réglable). Nouvelle session automatique après 6 h sans partie (réglable).
Corrections manuelles : boutons **+ / −**, *Annuler la dernière partie*, suppression d'une ligne de l'historique.

## Confidentialité

BoostSide fonctionne entièrement en local : il lit l'API locale du jeu et son journal, et sert les overlays sur `127.0.0.1`.
Aucune donnée n'est envoyée à un serveur. Données : `%APPDATA%\BoostSide\data.json`.

## Dépannage

- **« Stats API : non joignable » alors que le jeu tourne** : *Réglages → Activer / réparer l'API*, puis redémarrage complet du jeu.
- **Compte non détecté** : lance le jeu une fois, ou indique ton pseudo dans *Réglages → Qui est « toi »*.
- **MMR vide ou « ≈ »** : lance une recherche classée toi-même ; la vraie valeur s'affiche à la recherche suivante.
- **Setup 2 PC** : *Réglages → Serveur local → Accessible depuis le réseau local*, puis utilise l'IP du PC de jeu dans les URL.

## Développement

```bash
npm install
npm start                 # lance l'app (Electron)
npm test                  # tests unitaires (tracker, MMR, journal du jeu, OBS / Streamlabs…)
npm run e2e               # bout en bout : faux jeu -> tracker -> API / overlays / fichiers
npm run headless          # tracker sans interface (tableau de bord dans le navigateur)
node tools/simulator.js otwin win loss --speed 10                   # faux Rocket League (TCP 49123 + WebSocket 49124)
node tools/simulator.js win loss --log <Launch.log> --mmr 1150 --lag  # + journal du jeu avec MMR
node tools/sniff.js 120 capture.jsonl                                # enregistre le flux brut du vrai jeu
npm run dist              # installeur + version portable dans dist/
```

Publier une version : mettre à jour `version` dans `package.json` et `CHANGELOG.md`, puis `git tag vX.Y.Z && git push --tags`
(le workflow GitHub teste, compile et attache les `.exe` à la release).

Structure : `core/` (logique sans Electron), `web/` (tableau de bord + overlays), `electron/` (fenêtre, zone de notification,
raccourcis), `tools/` (simulateur, tests, captures), `test/` (tests unitaires).

## Licence

© 2026 Zoxam — tous droits réservés (voir [LICENSE](LICENSE)). Police Barlow Condensed : SIL Open Font License.

BoostSide n'est ni affilié, ni approuvé, ni sponsorisé par Psyonix LLC ou Epic Games, Inc. Rocket League est une marque de Psyonix LLC.
