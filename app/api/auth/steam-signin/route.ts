import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { encode } from 'next-auth/jwt';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('userId');
  
  if (!userId) {
    return NextResponse.redirect(new URL('/?error=NoUserId', request.url));
  }
  
  try {
    // Get the user with their Steam account
    const user = await prisma.user.findUnique({
      where: { id: parseInt(userId) },
      include: { 
        accounts: {
          where: { provider: 'steam' }
        } 
      },
    });
    
    if (!user || !user.accounts[0]) {
      return NextResponse.redirect(new URL('/?error=UserNotFound', request.url));
    }
    
    // Create a NextAuth-compatible session token
    const token = await encode({
      token: {
        sub: user.accounts[0].providerUserId,
        id: user.id,
        username: user.username,
        email: user.email,
        avatarUrl: user.avatarUrl,
        isAdmin: user.isAdmin,
        createdAt: user.createdAt,
      },
      secret: process.env.NEXTAUTH_SECRET!,
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });
    
    // Set the NextAuth session token cookie
    const cookieStore = await cookies();
    const cookieName = process.env.NODE_ENV === 'production' 
      ? '__Secure-next-auth.session-token' 
      : 'next-auth.session-token';
    
    cookieStore.set(cookieName, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: '/',
    });
    
    // Redirect to orbats page
    return NextResponse.redirect(new URL('/orbats', request.url));
    
  } catch (error) {
    console.error('Steam signin error:', error);
    return NextResponse.redirect(new URL('/?error=SigninError', request.url));
  }
}
