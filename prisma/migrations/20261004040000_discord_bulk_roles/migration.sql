CREATE TABLE "DiscordBulkRoleAction" (
  "id" SERIAL NOT NULL,
  "requestKey" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "configRevision" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "roleIds" JSONB NOT NULL,
  "requestedBy" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'preview_pending',
  "version" INTEGER NOT NULL DEFAULT 1,
  "nextPage" INTEGER NOT NULL DEFAULT 0,
  "memberCount" INTEGER NOT NULL DEFAULT 0,
  "previewCommandId" INTEGER NOT NULL,
  "executeCommandId" INTEGER,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiscordBulkRoleAction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DiscordBulkRoleAction_requestKey_key" ON "DiscordBulkRoleAction"("requestKey");
CREATE UNIQUE INDEX "DiscordBulkRoleAction_previewCommandId_key" ON "DiscordBulkRoleAction"("previewCommandId");
CREATE UNIQUE INDEX "DiscordBulkRoleAction_executeCommandId_key" ON "DiscordBulkRoleAction"("executeCommandId");
CREATE TABLE "DiscordBulkRolePage" (
  "id" SERIAL NOT NULL,
  "actionId" INTEGER NOT NULL,
  "page" INTEGER NOT NULL,
  "memberIds" JSONB NOT NULL,
  "outcomes" JSONB,
  "final" BOOLEAN NOT NULL,
  CONSTRAINT "DiscordBulkRolePage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DiscordBulkRolePage_actionId_page_key" ON "DiscordBulkRolePage"("actionId", "page");
ALTER TABLE "DiscordBulkRolePage" ADD CONSTRAINT "DiscordBulkRolePage_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "DiscordBulkRoleAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
