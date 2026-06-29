/**
 * Migration script to convert all data URL avatars to file storage
 * Run this script to migrate existing users with data URLs to the new file-based system
 * 
 * Usage: npx tsx scripts/migrate-data-urls.ts
 */

import { prisma } from '../lib/prisma';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Ensure upload directory exists
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'avatars');

async function ensureUploadDir() {
  try {
    await fs.access(UPLOAD_DIR);
  } catch {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    console.log(`Created upload directory: ${UPLOAD_DIR}`);
  }
}

function isDataUrl(url: string | null): boolean {
  return url ? url.startsWith('data:') : false;
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64Data: string } | null {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!match || match.length !== 3) {
    return null;
  }
  return {
    mimeType: match[1],
    base64Data: match[2]
  };
}

function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp'
  };
  return mimeToExt[mimeType] || 'jpg';
}

async function migrateUserAvatars() {
  await ensureUploadDir();
  
  console.log('Starting avatar migration...');
  
  // Find all users with data URL avatars
  const usersWithDataUrls = await prisma.user.findMany({
    where: {
      avatarUrl: {
        startsWith: 'data:'
      }
    },
    select: {
      id: true,
      username: true,
      avatarUrl: true
    }
  });
  
  console.log(`Found ${usersWithDataUrls.length} users with data URL avatars`);
  
  if (usersWithDataUrls.length === 0) {
    console.log('No users to migrate. Done!');
    return;
  }
  
  let migratedCount = 0;
  let failedCount = 0;
  
  for (const user of usersWithDataUrls) {
    try {
      if (!isDataUrl(user.avatarUrl)) {
        console.log(`User ${user.id} (${user.username}): Already migrated or not a data URL`);
        continue;
      }
      
      const parsed = parseDataUrl(user.avatarUrl!);
      if (!parsed) {
        console.log(`User ${user.id} (${user.username}): Invalid data URL format, skipping`);
        failedCount++;
        continue;
      }
      
      const extension = getExtensionFromMimeType(parsed.mimeType);
      const filename = `${uuidv4()}.${extension}`;
      const filePath = path.join(UPLOAD_DIR, filename);
      const publicUrl = `/uploads/avatars/${filename}`;
      
      // Save the file
      const buffer = Buffer.from(parsed.base64Data, 'base64');
      await fs.writeFile(filePath, buffer);
      
      // Update the user
      await prisma.user.update({
        where: { id: user.id },
        data: { avatarUrl: publicUrl }
      });
      
      console.log(`User ${user.id} (${user.username}): Migrated successfully`);
      migratedCount++;
      
    } catch (error) {
      console.error(`User ${user.id} (${user.username}): Migration failed - ${error instanceof Error ? error.message : String(error)}`);
      failedCount++;
    }
  }
  
  console.log(`\nMigration complete!`);
  console.log(`- Successfully migrated: ${migratedCount}`);
  console.log(`- Failed: ${failedCount}`);
  console.log(`- Total: ${usersWithDataUrls.length}`);
}

async function main() {
  try {
    await migrateUserAvatars();
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

main();
