# VALIDEO — Module Messagerie (étape 1)

Messagerie temps réel intégrée à VALIDEO : l'équipe discute avec ses clients
depuis la même application que les vidéos, sans que le client ait de compte à créer.

## Installation

1. **Créer les tables** :

   ```bash
   mysql -u <utilisateur> -p <base> < messagerie/schema.sql
   ```

2. Vérifier que `config.php` existe (copie de `config.example.php`).

3. Ouvrir `messages.php`. Au premier accès, l'équipe saisit son nom d'affichage
   (mémorisé en session).

Aucune dépendance externe : PHP + MySQL + JavaScript natif, comme le reste du projet.

## Utilisation

| Qui      | Adresse                     | Ce qu'il voit                        |
|----------|-----------------------------|--------------------------------------|
| Équipe   | `messages.php`              | Toutes les conversations             |
| Client   | `messages.php?acces=<jeton>`| Uniquement sa conversation           |

Le lien client est généré à la création de la conversation (bouton **+ Nouvelle**)
et copié dans le presse-papier. Le bouton 🔗 ajoute un contact supplémentaire
avec son propre lien.

## Architecture

```
messagerie/
├── schema.sql             Tables VALIDEO_msg_*
├── lib.php                Identité, token CSRF, signature d'état, helpers JSON
├── api/
│   ├── identite.php       Qui suis-je / enregistrement du nom d'équipe
│   ├── conversations.php  Liste, création, invitation d'un contact
│   ├── messages.php       Lecture (long-poll) + envoi idempotent
│   └── lecture.php        Accusés de lecture
├── messagerie.js          Client : transport, file d'envoi, rendu
├── messagerie-admin.js    Écrans réservés à l'équipe
└── messagerie.css         Styles
```

### Ce qui rend la messagerie réactive et stable

- **Long-polling** : la requête `messages.php` reste ouverte jusqu'à 25 s et
  répond dès qu'une signature d'état change (nouveau message, lecture,
  suppression). Latence perçue ≈ 0,7 s, sans marteler le serveur.
- **`session_write_close()` avant l'attente** : sans cela, le verrou de session
  PHP bloquerait toutes les autres requêtes de l'utilisateur.
- **Envoi idempotent** : chaque message porte un `client_uid`. Un renvoi après
  coupure réseau ne crée jamais de doublon (contrainte d'unicité en base).
- **File d'envoi persistée** (`localStorage`) : les messages écrits hors ligne
  partent automatiquement au retour du réseau.
- **Reconnexion exponentielle** et reprise immédiate au retour d'onglet.
- **Transport isolé** : `creerTransportLongPoll()` respecte une interface
  (`demarrer` / `arreter` / `reveiller`). Un transport WebSocket pourra le
  remplacer sans toucher au reste de l'interface.

## Réglages

Dans `lib.php` :

| Constante           | Défaut | Rôle                                        |
|---------------------|--------|---------------------------------------------|
| `MSG_ATTENTE_MAX`   | 25     | Durée max d'un long-poll (secondes)         |
| `MSG_ATTENTE_PAUSE` | 700000 | Intervalle de vérification (µs)             |
| `MSG_CORPS_MAX`     | 4000   | Longueur max d'un message                   |
| `MSG_DEBIT_MAX`     | 20     | Messages max par participant / 10 s         |

Sur un hébergement mutualisé au nombre de processus PHP limité, baisser
`MSG_ATTENTE_MAX` (ex. 10 s) réduit le nombre de connexions maintenues.

## Limite connue de cette étape

L'accès **équipe** n'est protégé par aucune authentification : le projet n'en
possède pas encore. Toute personne atteignant `messages.php` peut saisir un nom
et lire les conversations. En production, protéger le dossier (`.htaccess`,
VPN) ou brancher le module sur la page de login existante — c'est l'objet d'une
étape ultérieure.
