CREATE TABLE "DiscordRoleMenuMessage" (
    "id" SERIAL NOT NULL,
    "menuId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "lastCommandId" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DiscordRoleMenuMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DiscordRoleMenuMessage_menuId_channelId_key" ON "DiscordRoleMenuMessage"("menuId", "channelId");
