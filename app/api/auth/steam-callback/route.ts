import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export async function GET(request: NextRequest) {
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  console.log('[steam-callback] NEXTAUTH_URL:', process.env.NEXTAUTH_URL);
  console.log('[steam-callback] request.url:', request.url);
  console.log('[steam-callback] request.nextUrl.origin:', request.nextUrl.origin);
  console.log('[steam-callback] baseUrl:', baseUrl);
  const searchParams = request.nextUrl.searchParams;
  const claimedId = searchParams.get('openid.claimed_id');
  const mode = searchParams.get('openid.mode');
  
  // Verify it's a valid OpenID response
  if (mode !== 'id_res' || !claimedId) {
    return NextResponse.redirect(new URL('/?error=InvalidSteamResponse', baseUrl));
  }
  
  const steamId = claimedId.split('/').pop();
  
  if (!steamId) {
    return NextResponse.redirect(new URL('/?error=InvalidSteamID', baseUrl));
  }
  
  try {
    // Check if user is already logged in (linking account scenario)
    const session = await getServerSession(authOptions);
    
    // Fetch Steam profile
    const apiKey = process.env.STEAM_API_KEY;
    if (!apiKey) {
      throw new Error('STEAM_API_KEY not configured');
    }
    
    const response = await fetch(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${steamId}`
    );
    
    const data = await response.json();
    const player = data.response?.players?.[0];
    
    if (!player) {
      return NextResponse.redirect(new URL('/?error=SteamAPIError', baseUrl));
    }
    
    // Check if this Steam account already exists
    let authAccount = await prisma.authAccount.findUnique({
      where: {
        provider_providerUserId: {
          provider: 'steam',
          providerUserId: steamId,
        },
      },
      include: { user: true },
    });
    
    if (session?.user?.id) {
      // User is logged in - link Steam account to existing user
      if (authAccount) {
        if (authAccount.userId === session.user.id) {
          // Already linked to this user
          return NextResponse.redirect(new URL('/settings?success=AlreadyLinked', baseUrl));
        } else {
          // Steam account already linked to another user
          return NextResponse.redirect(new URL('/settings?error=SteamAlreadyLinked', baseUrl));
        }
      }
      
      // Link Steam account to current user
      await prisma.authAccount.create({
        data: {
          provider: 'steam',
          providerUserId: steamId,
          userId: session.user.id,
        },
      });
      
      // Update user's avatar if they don't have one
      const user = await prisma.user.findUnique({ where: { id: session.user.id } });
      if (!user?.avatarUrl && player.avatarfull) {
        await prisma.user.update({
          where: { id: session.user.id },
          data: { avatarUrl: player.avatarfull },
        });
      }
      
      return NextResponse.redirect(new URL('/settings?success=SteamLinked', baseUrl));
    }
    
    // User is not logged in - proceed with normal Steam login
    if (!authAccount) {
      // Create new user and link Steam account
      await prisma.user.create({
        data: {
          username: player.personaname || 'Steam User',
          email: null,
          avatarUrl: player.avatarfull || player.avatarmedium || null,
          accounts: {
            create: {
              provider: 'steam',
              providerUserId: steamId,
            },
          },
        },
      });
      
      authAccount = await prisma.authAccount.findUnique({
        where: {
          provider_providerUserId: {
            provider: 'steam',
            providerUserId: steamId,
          },
        },
        include: { user: true },
      });
    }
    
    if (!authAccount) {
      return NextResponse.redirect(new URL('/?error=DatabaseError', baseUrl));
    }
    
    // Store the Steam user info in a temporary session/cookie
    // Then redirect to a page that will use NextAuth's signIn with credentials
    const successUrl = new URL('/api/auth/steam-signin', baseUrl);
    successUrl.searchParams.set('userId', authAccount.user.id.toString());
    
    return NextResponse.redirect(successUrl);
    
  } catch (error) {
    console.error('Steam auth error:', error);
    return NextResponse.redirect(new URL('/?error=SteamAuthError', baseUrl));
  }
}
