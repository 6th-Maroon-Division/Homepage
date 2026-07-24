import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { processPendingEventsForUser } from '@/lib/pending-events';

export async function GET(request: NextRequest) {
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
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
    console.log('Steam callback - session:', session?.user?.id ? `User ID: ${session.user.id}` : 'No session');
    
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
      console.log('Steam callback - user is logged in, userId:', session.user.id);
      if (authAccount) {
        console.log('Steam callback - authAccount already exists, userId:', authAccount.userId);
        if (authAccount.userId === session.user.id) {
          // Already linked to this user
          console.log('Steam callback - already linked to this user');
          return NextResponse.redirect(new URL('/profile?success=AlreadyLinked', baseUrl));
        } else {
          // Steam account already linked to another user
          console.log('Steam callback - steam already linked to another user');
          return NextResponse.redirect(new URL('/profile?error=SteamAlreadyLinked', baseUrl));
        }
      }
      
      console.log('Steam callback - linking steam account to user:', session.user.id);
      // Link Steam account to current user
      await prisma.authAccount.create({
        data: {
          provider: 'steam',
          providerUserId: steamId,
          userId: session.user.id,
        },
      });
      console.log('Steam callback - successfully created authAccount for steam');

      // Backfill any pending raw attendance events for this Steam ID to the linked user
      await processPendingEventsForUser(steamId, null, session.user.id);
      
      // Update user's avatar if they don't have one
      const user = await prisma.user.findUnique({ where: { id: session.user.id } });
      if (!user?.avatarUrl && player.avatarfull) {
        await prisma.user.update({
          where: { id: session.user.id },
          data: { avatarUrl: player.avatarfull },
        });
      }
      
      return NextResponse.redirect(new URL('/profile?success=SteamLinked', baseUrl));
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
      
      // Get the newly created user to process any pending attendance events
      const newAuthAccount = await prisma.authAccount.findUnique({
        where: {
          provider_providerUserId: {
            provider: 'steam',
            providerUserId: steamId,
          },
        },
        include: { user: true },
      });

      // Process any pending events for this Steam ID
      if (newAuthAccount?.user) {
        await processPendingEventsForUser(steamId, null, newAuthAccount.user.id);
      }
      
      authAccount = newAuthAccount;
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
