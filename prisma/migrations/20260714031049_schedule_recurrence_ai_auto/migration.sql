-- CreateEnum
CREATE TYPE "TaskSchedulingMode" AS ENUM ('FIXED', 'AI_AUTO');

-- AlterTable
ALTER TABLE "fixed_events" ADD COLUMN     "is_cancelled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_recurrence_exception" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "original_occurrence_start" TIMESTAMP(3),
ADD COLUMN     "recurrence_end_at" TIMESTAMP(3),
ADD COLUMN     "recurrence_timezone" TEXT,
ADD COLUMN     "series_id" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "ai_constraints" JSONB,
ADD COLUMN     "is_cancelled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_recurrence_exception" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "original_occurrence_start" TIMESTAMP(3),
ADD COLUMN     "recurrence_end_at" TIMESTAMP(3),
ADD COLUMN     "recurrence_rule" TEXT,
ADD COLUMN     "recurrence_timezone" TEXT,
ADD COLUMN     "schedule_reason" TEXT,
ADD COLUMN     "scheduling_mode" "TaskSchedulingMode" NOT NULL DEFAULT 'AI_AUTO',
ADD COLUMN     "series_id" TEXT,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Taipei';

-- CreateIndex
CREATE INDEX "fixed_events_user_id_start_time_idx" ON "fixed_events"("user_id", "start_time");

-- CreateIndex
CREATE INDEX "fixed_events_user_id_series_id_idx" ON "fixed_events"("user_id", "series_id");

-- CreateIndex
CREATE INDEX "tasks_user_id_scheduled_start_idx" ON "tasks"("user_id", "scheduled_start");

-- CreateIndex
CREATE INDEX "tasks_user_id_status_idx" ON "tasks"("user_id", "status");

-- CreateIndex
CREATE INDEX "tasks_user_id_series_id_idx" ON "tasks"("user_id", "series_id");
