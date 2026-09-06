# Rapport de modifications

## Étape 1 — Socle de la messagerie temps réel

### Objectif
Disposer d'un équivalent de messagerie instantanée (type WhatsApp) intégré à
VALIDEO, afin de communiquer avec les clients à tout moment, sans leur imposer
la création d'un compte.

### Modifications réalisées

**Nouveau module `messagerie/`**
- `schema.sql` : trois tables `VALIDEO_msg_conversations`, `VALIDEO_msg_participants`
  et `VALIDEO_msg_messages` (utf8mb4 pour les emojis, clés étrangères en cascade).
- `lib.php` : sortie JSON normalisée, vérification du token de session déjà utilisé
  par le reste du projet, nettoyage des textes, résolution de l'identité
  (équipe interne / client via lien) et signature d'état d'une conversation.
- `api/identite.php` : lecture et enregistrement du nom affiché de l'équipe.
- `api/conversations.php` : liste des conversations avec aperçu et non-lus,
  création d'une conversation, génération du lien d'accès client.
- `api/messages.php` : lecture du fil en **long-polling** et envoi idempotent.
- `api/lecture.php` : accusés de lecture.
- `messagerie.js` : client (transport isolé, file d'envoi persistée en
  `localStorage`, rendu optimiste, reconnexion exponentielle).
- `messagerie-admin.js` : écrans réservés à l'équipe (nom affiché, création de
  conversation, invitation d'un contact).
- `messagerie.css` : interface deux colonnes, responsive (une seule colonne sur mobile).
- `README.md` : installation, architecture, réglages et limite connue.

**Fichiers existants**
- `messages.php` (nouveau) : page assemblant le module, en mode équipe ou client.
- `client_validation.php` : ajout de l'onglet « Messages » dans la barre de navigation.
- `README.md` : documentation du nouveau module.

### Choix techniques et raisons
- **Long-polling plutôt que rafraîchissement périodique** : latence perçue
  inférieure à une seconde sans multiplier les requêtes inutiles. La requête
  d'attente ferme la session PHP (`session_write_close`) pour ne pas bloquer les
  autres appels de l'utilisateur.
- **Envoi idempotent via `client_uid`** : une reprise après coupure réseau ne
  peut pas créer de doublon, ce qui est la première cause d'incohérence dans une
  messagerie mobile.
- **Transport isolé côté client** : un transport WebSocket pourra remplacer le
  long-polling sans modifier l'interface.
- **Accès client par lien signé** : cohérent avec la logique de partage déjà
  présente dans VALIDEO et sans friction pour le client.

### Limite assumée à cette étape
L'accès équipe n'est pas authentifié (le projet ne dispose pas encore de page de
login). Protéger le dossier ou brancher une authentification est proposé comme
étape ultérieure.
