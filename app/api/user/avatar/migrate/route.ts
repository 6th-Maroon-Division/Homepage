import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Ensure upload directory exists
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'avatars');

async function ensureUploadDir() {
  try {
    await fs.access(UPLOAD_DIR);
  } catch {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  }
}

// Function to detect if a string is a data URL
function isDataUrl(url: string | null): boolean {
  return url ? url.startsWith('data:') : false;
}

// Function to extract MIME type and base64 data from data URL
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

// Function to get file extension from MIME type
function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp'
  };
  return mimeToExt[mimeType] || 'jpg';
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Ensure upload directory exists
    await ensureUploadDir();

    // Get the user's current avatar URL
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { avatarUrl: true }
    });

    if (!user?.avatarUrl) {
      return NextResponse.json({
        success: true,
        message: 'No avatar to migrate'
      });
    }

    // Check if it's a data URL
    if (!isDataUrl(user.avatarUrl)) {
      return NextResponse.json({
        success: true,
        message: 'Avatar is already a proper URL, no migration needed',
        avatarUrl: user.avatarUrl
      });
    }

    // Parse the data URL
    const parsed = parseDataUrl(user.avatarUrl);
    if (!parsed) {
      return NextResponse.json({
        error: 'Invalid data URL format'
      }, { status: 400 });
    }

    // Generate filename and paths
    const extension = getExtensionFromMimeType(parsed.mimeType);
    const filename = `${uuidv4()}.${extension}`;
    const filePath = path.join(UPLOAD_DIR, filename);
    const publicUrl = `/uploads/avatars/${filename}`;

    // Save the file
    const buffer = Buffer.from(parsed.base64Data, 'base64');
    await fs.writeFile(filePath, buffer);

    // Update the user's avatar URL
    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: { avatarUrl: publicUrl },
      select: { avatarUrl: true }
    });

    // Clean up the old data URL from session if needed
    return NextResponse.json({
      success: true,
      message: 'Avatar migrated from data URL to file storage',
      oldAvatarUrl: user.avatarUrl.substring(0, 50) + '...', // Show truncated old URL
      newAvatarUrl: updatedUser.avatarUrl,
      migrated: true
    });

  } catch (error) {
    console.error('Error migrating avatar:', error);
    return NextResponse.json(
      { error: 'Failed to migrate avatar' },
      { status: 500 }
    );
  }
}