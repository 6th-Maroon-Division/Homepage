import { getServerSession } from 'next-auth/next';
import { notFound, redirect } from 'next/navigation';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import TrainingRequestWorkflowClient from '@/app/components/trainings/TrainingRequestWorkflowClient';
import { checkPermission } from '@/lib/auth-middleware';

export default async function TrainingRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/');

  const { id } = await params;
  const requestId = Number(id);
  if (!Number.isInteger(requestId) || requestId <= 0) notFound();

  const [canApprove, canMark] = await Promise.all([
    checkPermission(session.user.id, 'training:approve_request'),
    checkPermission(session.user.id, 'training:mark'),
  ]);
  const isStaff =
    canApprove ||
    canMark ||
    (session.user.permissions?.['system:super_admin'] ?? 0) > 0;

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <TrainingRequestWorkflowClient
          requestId={requestId}
          currentUserId={session.user.id}
          initialIsStaff={isStaff}
        />
      </div>
    </main>
  );
}
