-- =========================================================
-- VALIDEO — MODULE MESSAGERIE (étape 1 : socle temps réel)
-- Tables préfixées VALIDEO_msg_ afin de rester isolées de l'existant.
-- Encodage utf8mb4 obligatoire : emojis dans les messages.
-- =========================================================

CREATE TABLE IF NOT EXISTS VALIDEO_msg_conversations (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  titre         VARCHAR(160) NOT NULL,
  client_id     INT UNSIGNED NULL,
  project_id    INT UNSIGNED NULL,
  video_id      INT UNSIGNED NULL,
  archivee      TINYINT(1) NOT NULL DEFAULT 0,
  cree_le       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  maj_le        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_conv_client (client_id),
  KEY idx_conv_maj (maj_le)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS VALIDEO_msg_participants (
  id                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id       INT UNSIGNED NOT NULL,
  role                  ENUM('interne','client') NOT NULL DEFAULT 'client',
  nom                   VARCHAR(80) NOT NULL,
  -- Jeton du lien d'accès envoyé au client (aucun compte à créer côté client)
  acces_token           CHAR(40) NULL,
  dernier_message_lu_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  vu_le                 DATETIME NULL,
  cree_le               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_part_acces (acces_token),
  KEY idx_part_conv (conversation_id),
  CONSTRAINT fk_part_conv FOREIGN KEY (conversation_id)
    REFERENCES VALIDEO_msg_conversations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS VALIDEO_msg_messages (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id INT UNSIGNED NOT NULL,
  participant_id  INT UNSIGNED NULL,
  type            ENUM('texte','systeme') NOT NULL DEFAULT 'texte',
  corps           TEXT NOT NULL,
  -- Identifiant généré par le navigateur : rend l'envoi idempotent (réseau instable)
  client_uid      CHAR(36) NULL,
  cree_le         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  supprime_le     DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_msg_uid (conversation_id, client_uid),
  KEY idx_msg_conv (conversation_id, id),
  CONSTRAINT fk_msg_conv FOREIGN KEY (conversation_id)
    REFERENCES VALIDEO_msg_conversations (id) ON DELETE CASCADE,
  CONSTRAINT fk_msg_part FOREIGN KEY (participant_id)
    REFERENCES VALIDEO_msg_participants (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
