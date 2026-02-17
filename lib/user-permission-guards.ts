export function canModifyUserPermissions(actorUserId: number, targetUserId: number): boolean {
  return actorUserId !== targetUserId;
}
