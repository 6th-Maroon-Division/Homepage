/* eslint-disable @typescript-eslint/no-explicit-any */
import type { OAuthConfig, OAuthUserConfig } from 'next-auth/providers/oauth';

export interface SteamProfile {
  steamid: string;
  personaname: string;
  profileurl: string;
  avatar: string;
  avatarmedium: string;
  avatarfull: string;
  avatarhash: string;
}

export default function SteamProvider<P extends SteamProfile>(
  options: OAuthUserConfig<P>
): OAuthConfig<P> {
  return {
    id: 'steam',
    name: 'Steam',
    type: 'oauth',
    wellKnown: undefined,
    authorization: {
      url: 'https://steamcommunity.com/openid/login',
      params: {
        'openid.ns': 'http://specs.openid.net/auth/2.0',
        'openid.mode': 'checkid_setup',
        'openid.return_to': `${process.env.NEXTAUTH_URL}/api/auth/callback/steam`,
        'openid.realm': process.env.NEXTAUTH_URL,
        'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
        'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
      },
    },
    token: {
      url: `${process.env.NEXTAUTH_URL}/api/auth/callback/steam`,
      async request(context: any) {
        // The OpenID response comes in context.checks or context.params
        // We need to extract from the URL that NextAuth provides
        let steamId: string | undefined;
        
        // Try multiple ways to get the Steam ID
        if (context.checks?.openid_claimed_id) {
          steamId = context.checks.openid_claimed_id.split('/').pop();
        } else if (context.params?.['openid.claimed_id']) {
          steamId = context.params['openid.claimed_id'].split('/').pop();
        } else if (context.checks?.query) {
          // Check the query object
          const query = context.checks.query;
          if (query['openid.claimed_id']) {
            steamId = query['openid.claimed_id'].split('/').pop();
          }
        }
        
        // Last resort: check if there's a code parameter that might contain the steam ID
        if (!steamId && context.params?.code) {
          steamId = context.params.code;
        }
        
        console.log('Token request context keys:', Object.keys(context));
        console.log('Token request checks:', context.checks);
        console.log('Token request params:', context.params);
        
        if (!steamId) {
          throw new Error('No Steam ID found in callback');
        }
        
        return {
          tokens: {
            access_token: steamId,
          },
        };
      },
    },
    userinfo: {
      async request(context: any) {
        const steamId = context.tokens.access_token;
        
        if (!steamId) {
          throw new Error('No Steam ID found');
        }
        
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
          throw new Error('Failed to fetch Steam profile');
        }
        
        return player;
      },
    },
    profile(profile: P) {
      return {
        id: profile.steamid,
        name: profile.personaname,
        email: null as string | null, // Steam doesn't provide email
        image: profile.avatarfull,
      };
    },
    options,
  };
}
