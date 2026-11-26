# Cursus

Site pour enregistrer ses cours : un bouton central, une matière choisie, et le site transcrit, nettoie le bruit,
ne garde que les propos de l'enseignant, fait un récap, range le cours dans le **cours global** de la matière,
génère des **fiches de révision** (une notion, un chapitre ou tout le cours, avec les mots du professeur)
et permet de s'envoyer cours et fiches entre utilisateurs.

Même architecture que VZ Gym (Armure) : Netlify + une fonction + Netlify Blobs, comptes par pseudo et mot de passe
(scrypt), administrateur **avec le même identifiant et le même mot de passe que VZ Gym** (`/#admin`).

## Mettre en ligne (nouveau site Netlify)

1. Mets ce dossier dans un dépôt GitHub (nouveau dépôt, ou sous-dossier avec « Base directory » = `cours`).
2. Netlify > « Add new site » > « Import an existing project » > ce dépôt. Réglages par défaut (tout est dans `netlify.toml`).
3. **Ajoute les clés d'IA gratuites** (étape ci-dessous), soit dans Netlify, soit plus tard depuis `/#admin` > « Clés d'IA ».
4. Ouvre l'adresse `.netlify.app` : le micro n'est autorisé qu'en HTTPS, ce que Netlify fournit.

## L'IA gratuite et « infinie »

| Rôle | Service | Où créer la clé (gratuit) |
|---|---|---|
| Transcription de la voix | Groq (Whisper large v3 turbo) | console.groq.com/keys |
| Nettoyage, récap, cours, fiches | Google Gemini | aistudio.google.com/apikey |

Variables d'environnement Netlify (plusieurs clés séparées par des virgules) :
`GROQ_API_KEYS` et `GEMINI_API_KEYS`. Elles peuvent aussi être ajoutées depuis le panneau admin, sans redéployer.

**Comment ça ne s'arrête pas** : quand une clé dépasse son quota (erreur 429), elle est mise en pause jusqu'à l'heure de
renouvellement donnée par le service (minute, heure, ou minuit pour Gemini), puis réutilisée toute seule. Pendant la pause, le site
passe à la clé suivante, puis au modèle suivant (`gemini-2.5-flash` puis `gemini-2.5-flash-lite`), et la transcription
bascule sur Gemini si toutes les clés Groq sont en pause. Si tout est saturé, l'audio reste sur le téléphone et le site
réessaie tout seul à l'heure indiquée : rien n'est perdu, ça ralentit seulement.

Le gratuit a des plafonds réels. Groq : environ 7 200 secondes d'audio par heure et 28 800 par jour pour **l'ensemble de
l'organisation** (soit 8 h de cours par jour). Les limites Groq sont par compte et Gemini par projet : ajouter plusieurs
clés du **même** compte n'augmente rien. Pour plus de marge, ajoute des clés de comptes différents.
Variables facultatives : `GEMINI_MODELS`, `GROQ_TEXT_MODEL`, `GROQ_STT_MODEL`, `ADMIN_ID`, `ADMIN_PASSWORD`.

## Enregistrer avec l'écran allumé

Pendant l'enregistrement, le site demande au téléphone de ne pas mettre l'écran en veille (Wake Lock, avec un secours vidéo pour
les navigateurs plus anciens). Il faut garder la page ouverte au premier plan. Ajoute le site à l'écran d'accueil pour qu'il s'ouvre comme une appli.
L'audio est découpé en extraits de 2 minutes, gardés dans le téléphone (IndexedDB) jusqu'à leur envoi, et le site
reprend après une coupure de réseau, une page fermée ou un téléphone éteint (« Terminer et analyser »).

## Tester

    node test/run.mjs            # 22 tests de l'API avec une IA simulée
    node server.mjs              # site local (http://localhost:3000), a besoin des clés en variables d'environnement
    npx netlify dev              # comme sur Netlify (fonction + Blobs)

## Limites à connaître

- Un site web ne peut pas forcer l'enregistrement téléphone éteint ou écran verrouillé : iOS coupe le micro des pages web dès que l'écran se verrouille, Android le fait souvent.
- Whisper ne sépare pas les voix : « seulement le professeur » repose sur l'antibruit du micro, le filtre des segments douteux et une consigne à l'IA de ne garder que le contenu du cours.
- Une fonction Netlify a un temps maximal par appel : le traitement est découpé en petites étapes (une par extrait de 2 minutes) pour rester court.
- Les offres gratuites des services d'IA peuvent utiliser les contenus envoyés pour améliorer leurs produits : vérifie leurs conditions avant d'enregistrer des cours sensibles.
