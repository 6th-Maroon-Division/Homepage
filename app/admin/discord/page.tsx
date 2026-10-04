import { redirect } from 'next/navigation';
import { getApiSessionPrincipal } from '@/lib/api/auth';
import { hasApiPermission } from '@/lib/api/permissions';
import { PERMISSIONS, type PermissionKey } from '@/lib/permissions';
import DiscordAdminClient from './DiscordAdminClient';

export default async function DiscordAdminPage() {
  const principal = await getApiSessionPrincipal();
  const keys = (Object.keys(PERMISSIONS) as PermissionKey[]).filter(key => key.startsWith('discord:'));
  if (!principal || !keys.some(key => hasApiPermission(principal.permissions, key))) redirect('/admin');
  return <DiscordAdminClient defaultWebsiteUrl={process.env.NEXTAUTH_URL || ''} permissions={Object.fromEntries(keys.map(key => [key, hasApiPermission(principal.permissions, key)]))} />;
}
