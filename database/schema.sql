-- KidsPlay initial MariaDB schema.
-- Target: MariaDB 12.2.2; InnoDB, utf8mb4.
-- This script creates missing objects only. It does not migrate or modify existing tables.
-- Inspect existing tables and their definitions before applying this script.

USE `kidsplay_db`;

CREATE TABLE IF NOT EXISTS `users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(160) NOT NULL,
  `email` VARCHAR(254) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL COMMENT 'Backend-generated password_hash; never store plaintext passwords',
  `status` ENUM('pending', 'active', 'suspended', 'deleted') NOT NULL DEFAULT 'pending',
  `role` ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  `email_verified_at` DATETIME(3) NULL,
  `last_login_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`),
  KEY `idx_users_status_created` (`status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `token_hash` BINARY(32) NOT NULL COMMENT 'Hash only; never store the raw session token',
  `expires_at` DATETIME(3) NOT NULL,
  `revoked_at` DATETIME(3) NULL,
  `last_used_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_sessions_token_hash` (`token_hash`),
  KEY `idx_user_sessions_user_expiry` (`user_id`, `expires_at`),
  KEY `idx_user_sessions_expiry_revoked` (`expires_at`, `revoked_at`),
  CONSTRAINT `fk_user_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `password_reset_tokens` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `token_hash` BINARY(32) NOT NULL COMMENT 'Hash only; never store the raw reset token',
  `expires_at` DATETIME(3) NOT NULL,
  `used_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_password_reset_tokens_hash` (`token_hash`),
  KEY `idx_password_reset_user_expiry` (`user_id`, `expires_at`),
  CONSTRAINT `fk_password_reset_tokens_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `profiles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `avatar_path` VARCHAR(1024) NULL,
  `profile_type` ENUM('adult', 'child') NOT NULL DEFAULT 'child',
  `birth_date` DATE NULL,
  `status` ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_profiles_owner_status` (`owner_user_id`, `status`),
  CONSTRAINT `fk_profiles_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `profile_preferences` (
  `profile_id` BIGINT UNSIGNED NOT NULL,
  `autoplay_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `playback_quality` ENUM('auto', '480p', '720p', '1080p', '2160p') NOT NULL DEFAULT 'auto',
  `subtitles_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `subtitle_language` VARCHAR(16) NULL,
  `audio_language` VARCHAR(16) NOT NULL DEFAULT 'pt-BR',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`profile_id`),
  CONSTRAINT `chk_profile_preferences_autoplay` CHECK (`autoplay_enabled` IN (0, 1)),
  CONSTRAINT `chk_profile_preferences_subtitles` CHECK (`subtitles_enabled` IN (0, 1)),
  CONSTRAINT `fk_profile_preferences_profile` FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `titles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `slug` VARCHAR(180) NOT NULL,
  `description` TEXT NULL,
  `cover_path` VARCHAR(1024) NULL,
  `poster_path` VARCHAR(1024) NULL,
  `banner_path` VARCHAR(1024) NULL,
  `release_year` SMALLINT UNSIGNED NULL,
  `content_rating` VARCHAR(16) NULL,
  `publication_status` ENUM('draft', 'published', 'archived') NOT NULL DEFAULT 'draft',
  `display_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_titles_slug` (`slug`),
  KEY `idx_titles_publication_order` (`publication_status`, `display_order`, `id`),
  KEY `idx_titles_release_year` (`release_year`)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `title_tags` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `slug` VARCHAR(120) NOT NULL,
  `description` VARCHAR(255) DEFAULT NULL,
  `display_order` INT NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_title_tags_slug` (`slug`),
  KEY `idx_title_tags_active_order` (`is_active`, `display_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `title_tag_relations` (
  `title_id` BIGINT UNSIGNED NOT NULL,
  `tag_id` BIGINT UNSIGNED NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`title_id`, `tag_id`),
  KEY `idx_title_tag_relations_tag` (`tag_id`),
  CONSTRAINT `fk_title_tag_relations_tag` FOREIGN KEY (`tag_id`) REFERENCES `title_tags` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_title_tag_relations_title` FOREIGN KEY (`title_id`) REFERENCES `titles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `genres` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `slug` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_genres_slug` (`slug`),
  KEY `idx_genres_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `title_genres` (
  `title_id` BIGINT UNSIGNED NOT NULL,
  `genre_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`title_id`, `genre_id`),
  KEY `idx_title_genres_genre_title` (`genre_id`, `title_id`),
  CONSTRAINT `fk_title_genres_title` FOREIGN KEY (`title_id`) REFERENCES `titles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_title_genres_genre` FOREIGN KEY (`genre_id`) REFERENCES `genres` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `seasons` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title_id` BIGINT UNSIGNED NOT NULL,
  `season_number` SMALLINT UNSIGNED NOT NULL,
  `name` VARCHAR(255) NULL,
  `description` TEXT NULL,
  `publication_status` ENUM('draft', 'published', 'archived') NOT NULL DEFAULT 'draft',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_seasons_title_number` (`title_id`, `season_number`),
  KEY `idx_seasons_title_status` (`title_id`, `publication_status`),
  CONSTRAINT `chk_seasons_number` CHECK (`season_number` > 0),
  CONSTRAINT `fk_seasons_title` FOREIGN KEY (`title_id`) REFERENCES `titles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `episodes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `season_id` BIGINT UNSIGNED NOT NULL,
  `episode_number` SMALLINT UNSIGNED NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `duration_seconds` INT UNSIGNED NOT NULL,
  `thumbnail_path` VARCHAR(1024) NULL,
  `publication_status` ENUM('draft', 'published', 'archived') NOT NULL DEFAULT 'draft',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_episodes_season_number` (`season_id`, `episode_number`),
  KEY `idx_episodes_season_status_number` (`season_id`, `publication_status`, `episode_number`),
  CONSTRAINT `chk_episodes_number` CHECK (`episode_number` > 0),
  CONSTRAINT `chk_episodes_duration` CHECK (`duration_seconds` > 0),
  CONSTRAINT `fk_episodes_season` FOREIGN KEY (`season_id`) REFERENCES `seasons` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `media_assets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `episode_id` BIGINT UNSIGNED NOT NULL,
  `asset_format` ENUM('mp4', 'hls') NOT NULL,
  `quality` VARCHAR(16) NOT NULL,
  `asset_path` VARCHAR(2048) NOT NULL,
  `size_bytes` BIGINT UNSIGNED NULL,
  `is_available` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_media_assets_episode_format_quality` (`episode_id`, `asset_format`, `quality`),
  KEY `idx_media_assets_available_format` (`is_available`, `asset_format`),
  CONSTRAINT `chk_media_assets_available` CHECK (`is_available` IN (0, 1)),
  CONSTRAINT `fk_media_assets_episode` FOREIGN KEY (`episode_id`) REFERENCES `episodes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `favorites` (
  `profile_id` BIGINT UNSIGNED NOT NULL,
  `title_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`profile_id`, `title_id`),
  KEY `idx_favorites_title_profile` (`title_id`, `profile_id`),
  CONSTRAINT `fk_favorites_profile` FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_favorites_title` FOREIGN KEY (`title_id`) REFERENCES `titles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `watch_history` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `profile_id` BIGINT UNSIGNED NOT NULL,
  `episode_id` BIGINT UNSIGNED NOT NULL,
  `position_seconds` INT UNSIGNED NOT NULL DEFAULT 0,
  `duration_seconds` INT UNSIGNED NOT NULL,
  `is_completed` TINYINT(1) NOT NULL DEFAULT 0,
  `last_played_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_watch_history_profile_episode` (`profile_id`, `episode_id`),
  KEY `idx_watch_history_profile_last_played` (`profile_id`, `last_played_at`),
  KEY `idx_watch_history_episode` (`episode_id`),
  CONSTRAINT `chk_watch_history_position` CHECK (`position_seconds` <= `duration_seconds`),
  CONSTRAINT `chk_watch_history_completed` CHECK (`is_completed` IN (0, 1)),
  CONSTRAINT `fk_watch_history_profile` FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_watch_history_episode` FOREIGN KEY (`episode_id`) REFERENCES `episodes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `playback_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `profile_id` BIGINT UNSIGNED NOT NULL,
  `episode_id` BIGINT UNSIGNED NOT NULL,
  `event_type` ENUM('started', 'paused', 'resumed', 'progress', 'completed', 'error') NOT NULL,
  `position_seconds` INT UNSIGNED NOT NULL DEFAULT 0,
  `event_data` JSON NULL,
  `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_playback_events_profile_time` (`profile_id`, `occurred_at`),
  KEY `idx_playback_events_episode_time` (`episode_id`, `occurred_at`),
  KEY `idx_playback_events_type_time` (`event_type`, `occurred_at`),
  CONSTRAINT `fk_playback_events_profile` FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_playback_events_episode` FOREIGN KEY (`episode_id`) REFERENCES `episodes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `app_settings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `setting_key` VARCHAR(160) NOT NULL,
  `setting_value` LONGTEXT NOT NULL,
  `value_type` ENUM('string', 'number', 'boolean', 'json') NOT NULL DEFAULT 'string',
  `description` VARCHAR(500) NULL,
  `updated_by_user_id` BIGINT UNSIGNED NULL,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_app_settings_key` (`setting_key`),
  KEY `idx_app_settings_updated_by` (`updated_by_user_id`),
  CONSTRAINT `fk_app_settings_updated_by` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Post-run validation: server/database, expected tables, and foreign keys.
SELECT VERSION() AS `mariadb_version`, DATABASE() AS `database_name`;

SELECT `table_name`
FROM `information_schema`.`tables`
WHERE `table_schema` = DATABASE()
  AND `table_name` IN (
    'users', 'user_sessions', 'password_reset_tokens', 'profiles',
    'profile_preferences', 'titles', 'genres', 'title_genres', 'seasons',
    'episodes', 'media_assets', 'favorites', 'watch_history', 'title_tags', 'title_tag_relations',
    'playback_events', 'app_settings'
  )
ORDER BY `table_name`;

SELECT `table_name`, `constraint_name`, `column_name`, `referenced_table_name`, `referenced_column_name`
FROM `information_schema`.`key_column_usage`
WHERE `table_schema` = DATABASE()
  AND `referenced_table_name` IS NOT NULL
  AND `table_name` IN (
    'users', 'user_sessions', 'password_reset_tokens', 'profiles',
    'profile_preferences', 'titles', 'genres', 'title_genres', 'seasons',
    'episodes', 'media_assets', 'favorites', 'watch_history', 'title_tags', 'title_tag_relations',
    'playback_events', 'app_settings'
  )
ORDER BY `table_name`, `constraint_name`, `ordinal_position`;
