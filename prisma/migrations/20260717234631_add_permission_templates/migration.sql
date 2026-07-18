-- CreateTable
CREATE TABLE "PermissionTemplate" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PermissionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermissionTemplateItem" (
    "id" SERIAL NOT NULL,
    "templateId" INTEGER NOT NULL,
    "permissionId" INTEGER NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "PermissionTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PermissionTemplate_name_key" ON "PermissionTemplate"("name");

-- CreateIndex
CREATE INDEX "PermissionTemplate_createdAt_idx" ON "PermissionTemplate"("createdAt");

-- CreateIndex
CREATE INDEX "PermissionTemplateItem_templateId_idx" ON "PermissionTemplateItem"("templateId");

-- CreateIndex
CREATE INDEX "PermissionTemplateItem_permissionId_idx" ON "PermissionTemplateItem"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "PermissionTemplateItem_templateId_permissionId_key" ON "PermissionTemplateItem"("templateId", "permissionId");

-- AddForeignKey
ALTER TABLE "PermissionTemplateItem" ADD CONSTRAINT "PermissionTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PermissionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionTemplateItem" ADD CONSTRAINT "PermissionTemplateItem_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
