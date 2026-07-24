-- PostgreSQL requires newly-added enum values to be committed before a later
-- transaction can use them. Keep this migration intentionally small so the
-- following workflow migration can be fully atomic.
ALTER TYPE "TrainingRequestStatus" ADD VALUE IF NOT EXISTS 'in_training';
ALTER TYPE "TrainingRequestStatus" ADD VALUE IF NOT EXISTS 'finished';
ALTER TYPE "TrainingRequestStatus" ADD VALUE IF NOT EXISTS 'failed';
ALTER TYPE "TrainingRequestStatus" ADD VALUE IF NOT EXISTS 'needs_qualify';
ALTER TYPE "TrainingRequestStatus" ADD VALUE IF NOT EXISTS 'qualified';
ALTER TYPE "TrainingRequestStatus" ADD VALUE IF NOT EXISTS 'cancelled';
