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

**Une clé Groq suffit.** Groq transcrit la voix (Whisper) et écrit aussi le texte (récap, cours, fiches).

| Rôle | Service | Où créer la clé (gratuit) |
|---|---|---|
| Transcription de la voix | Groq (Whisper large v3 turbo) | console.groq.com/keys |
| Nettoyage, récap, cours, fiches | Groq (gpt-oss-120b, llama-4-scout, llama…) | console.groq.com/keys |

Variable d'environnement Netlify : `GROQ_API_KEYS` (plusieurs clés séparées par des virgules). Elles peuvent aussi être
ajoutées depuis `/#admin` > « Clés d'IA », sans redéployer. Jamais dans le dépôt GitHub.

**Comment ça ne s'arrête pas** : quand une clé ou un modèle dépasse son quota (erreur 429), il est mis en pause jusqu'à
l'heure de renouvellement donnée par le service, puis réutilisé tout seul. Pendant la pause, le site passe au modèle suivant
(`gpt-oss-120b`, `llama-4-scout`, `llama-3.3-70b-versatile`, `gpt-oss-20b`, `llama-3.1-8b-instant`), puis à la clé suivante.
Si tout est saturé, l'audio reste sur le téléphone et le site réessaie tout seul à l'heure indiquée : rien n'est perdu,
ça ralentit seulement.

Le travail est découpé en morceaux plus petits pour rester sous les plafonds de Groq (environ 8 000 jetons par
minute et 200 000 par jour pour chaque modèle texte, 28 800 secondes d'audio par jour, soit 8 h, pour la transcription :
vérifie tes chiffres sur console.groq.com/settings/limits). L'analyse d'un cours d'une heure prend alors quelques minutes.
Les limites Groq sont par compte : ajouter plusieurs clés du **même** compte n'augmente rien, il faut des comptes différents.
Variables facultatives : `GROQ_TEXT_MODELS`, `GROQ_STT_MODEL`, `ADMIN_ID`, `ADMIN_PASSWORD`.

## Enregistrer avec l'écran allumé

Pendant l'enregistrement, le site demande au téléphone de ne pas mettre l'écran en veille (Wake Lock, avec un secours vidéo pour
les navigateurs plus anciens). Il faut garder la page ouverte au premier plan. Ajoute le site à l'écran d'accueil pour qu'il s'ouvre comme une appli.
L'audio est découpé en extraits de 2 minutes, gardés dans le téléphone (IndexedDB) jusqu'à leur envoi, et le site
reprend après une coupure de réseau, une page fermée ou un téléphone éteint (« Terminer et analyser »).

## Tester

    node test/run.mjs            # 22 tests de l'API avec une IA simulée
    node test/groq-only.mjs      # 4 tests avec une seule clé Groq 
    node server.mjs              # site local (http://localhost:3000), a besoin des clés en variables d'environnement
    npx netlify dev              # comme sur Netlify (fonction + Blobs)

## Limites à connaître

- Un site web ne peut pas forcer l'enregistrement téléphone éteint ou écran verrouillé : iOS coupe le micro des pages web dès que l'écran se verrouille, Android le fait souvent.
- Whisper ne sépare pas les voix : « seulement le professeur » repose sur l'antibruit du micro, le filtre des segments douteux et une consigne à l'IA de ne garder que le contenu du cours.
- Une fonction Netlify a un temps maximal par appel : le traitement est découpé en petites étapes (une par extrait de 2 minutes) pour rester court.
- Les offres gratuites des services d'IA peuvent utiliser les contenus envoyés pour améliorer leurs produits : vérifie leurs conditions avant d'enregistrer des cours sensibles.

## Nouveautés (version 2)

- **Un seul cours par matière** : toutes les séances s'écrivent à la suite, dans l'ordre, chapitre par chapitre. Toutes les phrases du prof sont conservées (le code recopie le texte mot pour mot ; l'IA ne fait que retirer le bruit et découper en notions).
- **Éditeur** : bouton « Modifier » sur la page d'une matière → créer / renommer / déplacer / supprimer des chapitres, ajouter, modifier ou supprimer du texte. Au moment d'enregistrer, on choisit le chapitre où ranger la séance.
- **Fiches de révision** : récap par notions avec les phrases exactes du prof, modifiables ensuite.
- **Matières** : ranger (monter / descendre / A→Z), renommer, supprimer.
- **Apparence par compte** : thème, couleur d'accentuation et de surligneur (palette + roue de couleur), fond uni ou photo, papier, taille et police.
- **Administration** : cliquer un compte → en ligne / hors ligne, dernière connexion, nombre de connexions, IP, lieu approximatif, appareil, historique, et lecture de ses cours / séances / fiches.
  Le fournisseur d'accès (FAI) n'est pas disponible : Netlify ne le donne pas et aucun service tiers n'est appelé (vie privée). Les utilisateurs sont prévenus que l'admin voit ces informations.
- Les clés ne vont **jamais** dans GitHub : variables Netlify `GROQ_API_KEYS` (séparées par des virgules) ou panneau Administration.

Tests : `npm test` (40 tests).
