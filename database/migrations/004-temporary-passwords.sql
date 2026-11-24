-- Senha provisoria (gerada no Controle, vale 7 dias e precisa ser trocada no primeiro acesso)
-- e bloqueio temporario do login apos muitas senhas erradas.
ALTER TABLE `users`
  ADD COLUMN IF NOT EXISTS `temp_password_expires_at` DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS `failed_login_attempts` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `login_locked_until` DATETIME(3) NULL;
