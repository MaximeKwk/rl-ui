# Publier RL-UI sur le Microsoft Store

Pourquoi : c'est gratuit pour un développeur individuel, Microsoft signe l'application (plus d'avertissement SmartScreen) et le Store s'occupe des mises à jour.

## 1. Créer le compte développeur (gratuit)

1. Va sur **https://storedeveloper.microsoft.com** et connecte-toi avec ton compte Microsoft personnel.
2. Choisis **Individuel**, remplis ton nom et ton pays, puis la vérification d'identité (pièce d'identité + selfie, quelques minutes à quelques jours).

## 2. Réserver le nom de l'application

1. Dans **Partner Center** → *Applications et jeux* → **Nouveau produit** → **Application MSIX ou PWA**.
2. Nom : **RL-UI** (ou « RL-UI – Rocket League Overlay » si RL-UI est pris).
3. Ouvre *Gestion des produits* → **Identité du produit** et copie ces trois valeurs :
   - `Package/Identity/Name` (ex. `12345Zoxam.RL-UI`)
   - `Package/Identity/Publisher` (ex. `CN=ABCD1234-…`)
   - `Package/Properties/PublisherDisplayName`

Envoie-les : elles vont dans `package.json` → `build.appx` (`identityName`, `publisher`, `publisherDisplayName`), puis `npm run dist:store` construit `dist/RL-UI-Store-x.y.z.appx`.

## 3. Soumission

| Étape | Quoi mettre |
| --- | --- |
| **Tarification** | Gratuit · tous les marchés |
| **Propriétés** | Catégorie *Utilitaires et outils* (ou *Photo et vidéo*) · URL de confidentialité : `https://github.com/MaximeKwk/rl-ui/blob/main/PRIVACY.md` · Site web : `https://github.com/MaximeKwk/rl-ui` |
| **Classification par âge** | Questionnaire : pas de contenu violent, pas d'achat, pas d'échange entre utilisateurs dans l'app → *PEGI 3 / Everyone* |
| **Packages** | Dépose `RL-UI-Store-x.y.z.appx` |
| **Fiche (anglais + français)** | Textes ci-dessous, captures `docs/images/*.png` (au moins une en 1920×1080 : `caster.png` en grand, ou captures du tableau de bord) |
| **Notes pour la certification** | « Desktop app for Rocket League streamers. It reads the official Rocket League Stats API on the local machine and serves browser overlays on 127.0.0.1 for OBS/Streamlabs. runFullTrust is needed to run the local overlay server and read the game's log and Stats API config. No account needed; everything works without the game running (dashboard shows “Rocket League closed”). » |

La fonction *runFullTrust* est demandée par toutes les applications de bureau classiques : il faut la justifier avec la note ci-dessus.

## Fiche du Store

### English

**Short description:** Track your Rocket League wins, losses and MMR, and make your stream react to victories, defeats and overtime.

**Description:**

RL-UI tracks your Rocket League matches automatically and brings them to your stream.

• Wins, losses, overtime, MVP and your real MMR, detected automatically through Rocket League's official Stats API — no mods, EAC-compatible.
• Browser overlays for OBS and Streamlabs: W/L counter (horizontal, vertical or next to the boost gauge), animated full-screen alerts with sounds, recent matches, session recap.
• Caster mode: a full broadcast overlay for casting matches as a spectator — scorebug, Bo1–Bo7 series, every player's boost, spectated player card, goal banner, end-of-match scoreboard.
• Themes: pick a ready-made look or create your own with your images, font, colors and sounds.
• Automatic OBS / Streamlabs actions, Stream Deck URLs, global hotkeys, text files.
• English and French. Everything runs locally: no account, no telemetry.

RL-UI is an independent project, not affiliated with Psyonix LLC or Epic Games, Inc. Rocket League is a trademark of Psyonix LLC.

**Features (list):** Automatic win/loss/MMR tracking · Victory, defeat and overtime alerts · W/L counter overlays · Caster mode for spectators · Custom themes · OBS and Streamlabs actions · Stream Deck support

**Keywords:** Rocket League, stream overlay, OBS, Streamlabs, MMR tracker, win loss counter, caster

### Français

**Description courte :** Suis tes victoires, défaites et ton MMR sur Rocket League, et fais réagir ton stream aux victoires, défaites et overtimes.

**Description :**

RL-UI suit automatiquement tes parties de Rocket League et les affiche sur ton stream.

• Victoires, défaites, overtimes, MVP et ton vrai MMR, détectés automatiquement grâce à la Stats API officielle de Rocket League — sans mod, compatible EAC.
• Overlays navigateur pour OBS et Streamlabs : compteur V/D (horizontal, vertical ou collé à la jauge de boost), alertes plein écran animées avec sons, dernières parties, récap de session.
• Mode caster : un overlay de diffusion complet pour caster des matchs en spectateur — tableau des scores, séries BO1 à BO7, boost de chaque joueur, carte du joueur suivi, bannière de but, tableau de fin de match.
• Thèmes : choisis une DA toute faite ou crée la tienne avec tes images, ta police, tes couleurs et tes sons.
• Actions automatiques OBS / Streamlabs, URLs Stream Deck, raccourcis clavier globaux, fichiers texte.
• Anglais et français. Tout fonctionne en local : pas de compte, pas de télémétrie.

RL-UI est un projet indépendant, non affilié à Psyonix LLC ni à Epic Games, Inc. Rocket League est une marque de Psyonix LLC.

**Mots-clés :** Rocket League, overlay stream, OBS, Streamlabs, suivi MMR, compteur victoires défaites, caster
