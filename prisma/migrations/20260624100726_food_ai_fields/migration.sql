-- AlterTable
ALTER TABLE "ingredients" ADD COLUMN     "ai_confidence" DECIMAL(5,2),
ADD COLUMN     "estimated_days_remaining" INTEGER,
ADD COLUMN     "expiry_source" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "freshness_status" TEXT,
ADD COLUMN     "image_url" TEXT,
ADD COLUMN     "ocr_raw_text" TEXT,
ADD COLUMN     "source_type" TEXT NOT NULL DEFAULT 'manual';

-- AlterTable
ALTER TABLE "meal_plans" ADD COLUMN     "ai_reason" TEXT,
ADD COLUMN     "is_ai_generated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nutrition_summary" TEXT;

-- AlterTable
ALTER TABLE "recipes" ADD COLUMN     "ai_reason" TEXT,
ADD COLUMN     "is_ai_generated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "missing_ingredients" JSONB,
ADD COLUMN     "nutrition_json" JSONB;
