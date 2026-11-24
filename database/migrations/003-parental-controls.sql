-- Area dos Pais: limite diario, bloqueio de titulos e tempo assistido por perfil,
-- sugestoes de desenhos para o administrador e senha provisoria para contas novas.
ALTER TABLE `users`
  ADD COLUMN IF NOT EXISTS `must_change_password` TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE `profile_preferences`
  ADD COLUMN IF NOT EXISTS `daily_limit_minutes` SMALLINT UNSIGNED NULL;

CREATE TABLE IF NOT EXISTS `profile_blocked_titles` (
  `profile_id` BIGINT UNSIGNED NOT NULL,
  `title_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`profile_id`, `title_id`),
  KEY `idx_profile_blocked_titles_title` (`title_id`),
  CONSTRAINT `fk_profile_blocked_titles_profile` FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_profile_blocked_titles_title` FOREIGN KEY (`title_id`) REFERENCES `titles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `profile_daily_usage` (
  `profile_id` BIGINT UNSIGNED NOT NULL,
  `usage_date` DATE NOT NULL,
  `watched_seconds` INT UNSIGNED NOT NULL DEFAULT 0,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`profile_id`, `usage_date`),
  CONSTRAINT `fk_profile_daily_usage_profile` FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `title_suggestions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `profile_id` BIGINT UNSIGNED NULL,
  `title_name` VARCHAR(160) NOT NULL,
  `note` VARCHAR(500) NULL,
  `status` ENUM('pending', 'added', 'declined') NOT NULL DEFAULT 'pending',
  `admin_note` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_title_suggestions_status_created` (`status`, `created_at`),
  KEY `idx_title_suggestions_user_created` (`user_id`, `created_at`),
  CONSTRAINT `fk_title_suggestions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_title_suggestions_profile` FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
