import { redirect } from 'next/navigation';

interface LegacyTemplateEditRouteProps {
  params: Promise<{ id: string }>;
}

export default async function LegacyTemplateEditRoute({ params }: LegacyTemplateEditRouteProps) {
  const { id } = await params;
  redirect(`/admin/templates/${id}`);
}
