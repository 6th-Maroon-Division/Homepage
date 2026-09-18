# Final API security corrections

- Target hierarchy parsing now fails closed if any stored target grant has an unknown key or invalid level. Previously the fallback to empty grants discarded an otherwise valid superadmin barrier. Both `canAccessApiUser` and `canManageTrainingRequest` deny non-superadmins in this case; existing self access and the explicit bot/superadmin override remain. Actor parsing still defaults to no permissions on malformed grants. Six unit cases and one real Prisma legacy-value case cover this boundary.
- Durable SSE now uses the shared subscriber-bound principal revalidator, including captured session expiry, avoiding any dependency on publishers' ambient request sessions. Revocation produces a metadata-only denied audit and closes the stream. Its one-MiB queue limit closes stalled/oversized streams instead of buffering indefinitely; consumers resume by last delivered event ID. Two additional unit regressions cover publisher identity changes/expiry and queue capacity.

No endpoint or payload contract changes. Existing auth transport documentation separately covers provider verification, login state, denied-auth audits and transactional attendance linking.
