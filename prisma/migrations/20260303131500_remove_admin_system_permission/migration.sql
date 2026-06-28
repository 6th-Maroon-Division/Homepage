DELETE FROM "UserPermission"
WHERE "permissionId" IN (
  SELECT "id" FROM "Permission" WHERE "key" = 'admin:system'
);

DELETE FROM "Permission"
WHERE "key" = 'admin:system';
