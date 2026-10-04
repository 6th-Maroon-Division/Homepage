-- Add catalog entries only. Existing user grants and templates remain unchanged.
INSERT INTO "Permission" ("key", "description", "defaultValue", "maxValue", "createdAt", "updatedAt")
VALUES
  ('discord:view', 'View Discord bot status and operational activity', 0, 255, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('discord:configure', 'Manage Discord bot configuration, role menus, and synchronization settings', 0, 255, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('discord:announce', 'Publish, refresh, and re-ping Discord ORBAT announcements', 0, 255, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('discord:retry', 'Retry failed Discord operations subject to their original action permissions', 0, 255, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('discord:moderation_view', 'View Discord moderation cases and punishment history without evidence content', 0, 255, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('discord:timeout_release', 'Release Discord member timeouts early', 0, 255, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('discord:evidence_view', 'View Discord moderation evidence, attachments, and recoverable evidence', 0, 255, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('discord:evidence_delete', 'Soft-delete Discord moderation evidence including indefinitely retained items', 0, 255, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('discord:evidence_restore', 'Restore Discord moderation evidence during its recovery window', 0, 255, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('discord:evidence_retention', 'Manage Discord evidence retention policy and per-item indefinite retention', 0, 255, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET
  "description" = EXCLUDED."description",
  "defaultValue" = 0,
  "maxValue" = 255,
  "updatedAt" = CURRENT_TIMESTAMP;
