-- Convert only title cover and banner paths from the former C: project root
-- to portable URLs. Review the preview query before committing the changes.
-- Safe to rerun: paths already converted to /files/... are not matched.

USE `kidsplay_db`;

-- Adjust this prefix if the paths shown by the preview use a different root.
-- Forward slashes are intentional; stored Windows backslashes are normalized below.
SET @old_files_prefix = 'C:/Users/marce/Documents/GitHub/KidsPlay Streaming Layout/files/';
-- Keep at 0 to preview only. Set to 1 after confirming the prefix and matching rows.
SET @apply_updates = 0;

SELECT `id`, `name`, `cover_path`, `banner_path`
FROM `titles`
WHERE (`cover_path` IS NOT NULL AND LEFT(REPLACE(`cover_path`, CHAR(92), '/'), CHAR_LENGTH(@old_files_prefix)) = @old_files_prefix)
   OR (`banner_path` IS NOT NULL AND LEFT(REPLACE(`banner_path`, CHAR(92), '/'), CHAR_LENGTH(@old_files_prefix)) = @old_files_prefix)
ORDER BY `id`;

START TRANSACTION;

UPDATE `titles`
SET `cover_path` = CONCAT('/files/', SUBSTRING(REPLACE(`cover_path`, CHAR(92), '/'), CHAR_LENGTH(@old_files_prefix) + 1))
WHERE @apply_updates = 1
  AND `cover_path` IS NOT NULL
  AND LEFT(REPLACE(`cover_path`, CHAR(92), '/'), CHAR_LENGTH(@old_files_prefix)) = @old_files_prefix;
SET @cover_paths_updated = ROW_COUNT();

UPDATE `titles`
SET `banner_path` = CONCAT('/files/', SUBSTRING(REPLACE(`banner_path`, CHAR(92), '/'), CHAR_LENGTH(@old_files_prefix) + 1))
WHERE @apply_updates = 1
  AND `banner_path` IS NOT NULL
  AND LEFT(REPLACE(`banner_path`, CHAR(92), '/'), CHAR_LENGTH(@old_files_prefix)) = @old_files_prefix;
SET @banner_paths_updated = ROW_COUNT();

SELECT
  @cover_paths_updated AS `cover_paths_updated`,
  @banner_paths_updated AS `banner_paths_updated`,
  (
    SELECT COUNT(*)
    FROM `titles`
    WHERE LEFT(LOWER(REPLACE(COALESCE(`cover_path`, ''), CHAR(92), '/')), 3) = 'c:/'
       OR LEFT(LOWER(REPLACE(COALESCE(`banner_path`, ''), CHAR(92), '/')), 3) = 'c:/'
  ) AS `remaining_c_drive_title_paths`;

COMMIT;