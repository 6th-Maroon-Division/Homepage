import { apiSuccess } from '@/lib/api/response';
import { body, demand, discordApi, fail, id, integration, query, transaction } from './shared';
import { enqueue, commandDto } from './commands';

/** Explicitly restart exhausted join-role work; a honeypot ban always wins. */
export function retryOperation(request: Request, value: string) {
  return discordApi(request, 'discord:retry', async (principal, audit) => {
    demand(principal, 'discord:configure');
    query(request);
    const operationId = id(value);
    const input = await body(request, ['requestKey']);
    const command = await transaction(async tx => {
      const operation = await tx.discordOperation.findUnique({where: {id: operationId}});
      if (!operation) return fail(404, 'Operation report not found.');
      if (operation.kind !== 'join.roles' || operation.status !== 'failed' || !operation.memberId) return fail(409, 'Only failed member join-role assignments can be retried.');
      const {row, settings} = await integration(tx);
      if (!row || settings.guildId !== operation.guildId || !(settings.defaultRoleIds as string[]).length) return fail(409, 'Configure default roles for this server first.');
      const ban = await tx.discordModerationCase.findFirst({where: {guildId: operation.guildId, memberId: operation.memberId, action: 'ban'}});
      if (ban) return fail(409, 'Join-role assignment is cancelled for a honeypot ban.');
      const pending = await tx.discordCommand.findFirst({where: {kind: 'join.retry', status: {in: ['pending', 'running']}, payload: {path: ['memberId'], equals: operation.memberId}}});
      if (pending && pending.requestKey !== input.requestKey) return fail(409, 'A retry is already pending for this member.');
      return enqueue(tx, principal, audit, input.requestKey, 'join.retry', {operationId, memberId: operation.memberId, guildId: operation.guildId, configRevision: row.revision});
    });
    return apiSuccess(commandDto(command), {status: 202});
  });
}
