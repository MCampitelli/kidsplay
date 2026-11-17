-- Convert local media paths from the former C: project root to portable URLs.
-- Run against kidsplay_db after confirming the project files exist on the new drive.
-- Safe to rerun: rows already converted to /files/... are not matched.

USE `kidsplay_db`;
START TRANSACTION;

SET @old_files_prefix = CONVERT(0x433A5C55736572735C6D617263655C446F63756D656E74735C4769744875625C4B696473506C61792053747265616D696E67204C61796F75745C66696C65735C USING utf8mb4);

UPDATE `titles`
SET `cover_path` = CONCAT('/files/', REPLACE(SUBSTRING(`cover_path`, CHAR_LENGTH(@old_files_prefix) + 1), CHAR(92), '/'))
WHERE `cover_path` IS NOT NULL AND LEFT(`cover_path`, CHAR_LENGTH(@old_files_prefix)) = @old_files_prefix;
SET @cover_paths_updated = ROW_COUNT();

UPDATE `titles`
SET `poster_path` = CONCAT('/files/', REPLACE(SUBSTRING(`poster_path`, CHAR_LENGTH(@old_files_prefix) + 1), CHAR(92), '/'))
WHERE `poster_path` IS NOT NULL AND LEFT(`poster_path`, CHAR_LENGTH(@old_files_prefix)) = @old_files_prefix;
SET @poster_paths_updated = ROW_COUNT();

UPDATE `titles`
SET `banner_path` = CONCAT('/files/', REPLACE(SUBSTRING(`banner_path`, CHAR_LENGTH(@old_files_prefix) + 1), CHAR(92), '/'))
WHERE `banner_path` IS NOT NULL AND LEFT(`banner_path`, CHAR_LENGTH(@old_files_prefix)) = @old_files_prefix;
SET @banner_paths_updated = ROW_COUNT();

UPDATE `episodes`
SET `thumbnail_path` = CONCAT('/files/', REPLACE(SUBSTRING(`thumbnail_path`, CHAR_LENGTH(@old_files_prefix) + 1), CHAR(92), '/'))
WHERE `thumbnail_path` IS NOT NULL AND LEFT(`thumbnail_path`, CHAR_LENGTH(@old_files_prefix)) = @old_files_prefix;
SET @episode_thumbnails_updated = ROW_COUNT();

UPDATE `media_assets`
SET `asset_path` = CONCAT('/files/', REPLACE(SUBSTRING(`asset_path`, CHAR_LENGTH(@old_files_prefix) + 1), CHAR(92), '/'))
WHERE LEFT(`asset_path`, CHAR_LENGTH(@old_files_prefix)) = @old_files_prefix;
SET @media_assets_updated = ROW_COUNT();

UPDATE `profiles`
SET `avatar_path` = CONCAT('/files/', REPLACE(SUBSTRING(`avatar_path`, CHAR_LENGTH(@old_files_prefix) + 1), CHAR(92), '/'))
WHERE `avatar_path` IS NOT NULL AND LEFT(`avatar_path`, CHAR_LENGTH(@old_files_prefix)) = @old_files_prefix;
SET @profile_avatars_updated = ROW_COUNT();

SELECT
  @cover_paths_updated AS `cover_paths_updated`,
  @poster_paths_updated AS `poster_paths_updated`,
  @banner_paths_updated AS `banner_paths_updated`,
  @episode_thumbnails_updated AS `episode_thumbnails_updated`,
  @media_assets_updated AS `media_assets_updated`,
  @profile_avatars_updated AS `profile_avatars_updated`;

COMMIT;