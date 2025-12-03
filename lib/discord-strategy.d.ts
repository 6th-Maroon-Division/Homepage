// types/discord-strategy.d.ts
declare module 'discord-strategy' {
  import { Strategy } from 'passport';

  interface DiscordProfile {
    id: string;
    username: string;
    discriminator: string;
    email?: string;
    avatar?: string;
  }

  interface DiscordStrategyOptions {
    clientID: string;
    clientSecret: string;
    callbackURL: string;
    scope?: string;
  }

  // Define a more specific type for the done function
  type DoneCallback = (err: Error | null, user?: DiscordProfile | false | null) => void;

  class DiscordStrategy extends Strategy {
    constructor(options: DiscordStrategyOptions, verify: (accessToken: string, refreshToken: string, profile: DiscordProfile, done: DoneCallback) => void);

    userProfile(accessToken: string, done: DoneCallback): void;
  }

  export = DiscordStrategy;
}
