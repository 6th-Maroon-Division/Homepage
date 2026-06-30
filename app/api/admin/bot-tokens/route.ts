import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/auth-middleware';

// GET /api/admin/bot-tokens - List all bot tokens
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const hasPermission = await checkPermission(session.user.id, 'system:super_admin');
  if (!hasPermission) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const tokens = await prisma.botToken.findMany({
      orderBy: { name: 'asc' },
      include: {
        createdBy: {
          select: { id: true, username: true },
        },
      },
    });

    // Mask tokens in response for security (only show name, id, isActive, etc.)
    const safeTokens = tokens.map(token => ({
      id: token.id,
      name: token.name,
      isActive: token.isActive,
      createdAt: token.createdAt,
      lastUsedAt: token.lastUsedAt,
      createdBy: token.createdBy,
    }));

    return NextResponse.json({ tokens: safeTokens });
  } catch (error) {
    console.error('Error fetching bot tokens:', error);
    return NextResponse.json(
      { error: 'Failed to fetch bot tokens' },
      { status: 500 }
    );
  }
}

// POST /api/admin/bot-tokens - Create a new bot token
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const hasPermission = await checkPermission(session.user.id, 'system:super_admin');
  if (!hasPermission) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return NextResponse.json(
        { error: 'Token name is required and must be a non-empty string' },
        { status: 400 }
      );
    }

    // Generate a secure random token
    const token = generateSecureToken();

    const newToken = await prisma.botToken.create({
      data: {
        name: name.trim(),
        token,
        createdById: session.user.id,
      },
    });

    // Return the token value only once (for the admin to copy)
    return NextResponse.json({
      success: true,
      token: {
        id: newToken.id,
        name: newToken.name,
        token: newToken.token, // Only returned on creation
        isActive: newToken.isActive,
        createdAt: newToken.createdAt,
      },
    });
  } catch (error) {
    console.error('Error creating bot token:', error);
    return NextResponse.json(
      { error: 'Failed to create bot token' },
      { status: 500 }
    );
  }
}

// Helper function to generate a secure random token
function generateSecureToken(): string {
  const crypto = require('crypto');
  return crypto.randomBytes(32).toString('hex');
}
