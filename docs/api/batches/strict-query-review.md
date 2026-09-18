# Final argument consistency review

The earliest migrated resources now use the same strict query validation as later batches. Every affected method declares its allowed keys; unknown and duplicate keys return400 after authentication, including mutation routes that allow no query parameters. This covers47 catalogue, token, audit, preference, leave-of-absence, rank/history and user-status methods.

Bot-token and notification-preference path IDs are bounded to positive Int32 before Prisma. Numeric JSON IDs remain numbers (string aliases rejected). Request scheduling inputs explicitly label their UTC interpretation; session-management inputs retain browser-local display converted to zoned API timestamps.

109 focused tests exercise every affected method, session/bot authentication, allowed filter behavior, invalid query keys, path overflow and JSON ID types. These checks supplement each resource's existing behavior/integration suite.
