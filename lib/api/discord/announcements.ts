import { prisma } from '@/lib/prisma';
import { apiSuccess } from '@/lib/api/response';
import { snowflake } from '@/lib/discord/config';
import { body, demand, discordApi, fail, id, integration, query, text, transaction } from './shared';
import { enqueue, commandDto } from './commands';
export function announcement(request:Request,value:string,method:'GET'|'POST') {
  return discordApi(request,'discord:announce',async(p,c)=>{
    demand(p,'orbat:edit');query(request);const orbatId=id(value);
    if(!await prisma.orbat.findUnique({where:{id:orbatId},select:{id:true}})) fail(404,'ORBAT not found.');
    if(method==='GET') {
      const {settings}=await integration();const announcement=await prisma.discordAnnouncement.findUnique({where:{orbatId}});
      const commands=await prisma.discordCommand.findMany({where:{kind:{startsWith:'announcement.'},payload:{path:['orbatId'],equals:orbatId}},orderBy:{id:'desc'},take:10});
      const config=Object.fromEntries(['guildId','announcementChannelId','mentionRoleIds','allowEveryoneMention','announcementTemplate','announcementsEnabled','websiteUrl'].map(k=>[k,settings[k]]));
      return apiSuccess({announcement,config,commands:commands.map(r=>commandDto(r))});
    }
    const b=await body(request,['requestKey','action','channelId','mention','missionText']);
    if(!['publish','refresh','reping','repost'].includes(String(b.action))||!snowflake(b.channelId)||!text(b.missionText,1800)||!text(b.mention,30)) fail(422,'Invalid announcement request.');
    if(b.action==='repost'&&b.mention!=='none') fail(422,'Reposting a missing message must not ping. Send a separate explicit ping after recovery.');
    const command=await transaction(async tx=>{
      const {settings}=await integration(tx); if(!settings.announcementsEnabled) fail(409,'Enable announcements in Discord configuration first.');
      if(b.mention!=='none'&&!(b.mention==='everyone'&&settings.allowEveryoneMention)&&!(settings.mentionRoleIds as string[]).includes(String(b.mention))) fail(422,'This mention target is not allowed.');
      const old=await tx.discordAnnouncement.findUnique({where:{orbatId}});
      const duplicate=await tx.discordCommand.findUnique({where:{requestKey:String(b.requestKey)}});
      if(!duplicate) {
        const pending=await tx.discordCommand.findFirst({where:{kind:{startsWith:'announcement.'},status:{in:['pending','running']},payload:{path:['orbatId'],equals:orbatId}}});
        if(pending) fail(409,'An announcement action is already pending.');
        if(old&&old.channelId!==b.channelId) fail(409,'Refresh the existing announcement in its original channel.');
        if(b.action==='repost'&&!old?.missingAt) fail(409,'Only a reported missing announcement can be reposted.');
        if(old?.missingAt&&b.action!=='repost') fail(409,'The announcement is missing. Explicitly repost it without a ping first.');
        if(b.action==='publish'&&old?.messageId) fail(409,'Already published. Use refresh or explicitly send another ping.');
        if(b.action!=='publish'&&!old?.messageId) fail(409,'Publish and wait for confirmation first.');
      }
      const row=await enqueue(tx,p,c,b.requestKey,`announcement.${b.action}`,{orbatId,channelId:b.channelId,mention:b.mention,missionText:b.missionText});
      if(!duplicate) await tx.discordAnnouncement.upsert({where:{orbatId},create:{orbatId,channelId:String(b.channelId),mention:String(b.mention),missionText:String(b.missionText)},update:{mention:String(b.mention),missionText:String(b.missionText)}});
      return row;
    });return apiSuccess(commandDto(command),{status:202});
  });
}
