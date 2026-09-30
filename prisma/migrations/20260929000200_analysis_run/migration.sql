CREATE TABLE "AnalysisRun" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "propertyId" UUID NOT NULL,
  "mode" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "strategyProfile" TEXT NOT NULL,
  "engineVersion" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "reasoningEffort" TEXT NOT NULL,
  "userInputs" JSONB NOT NULL,
  "inputSnapshot" JSONB NOT NULL,
  "engineResult" JSONB NOT NULL,
  "aiResult" JSONB,
  "inputHash" TEXT NOT NULL,
  "requestKey" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(6),
  "failureCode" TEXT,
  "tokenUsage" JSONB,
  "latencyMs" INTEGER,
  CONSTRAINT "AnalysisRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AnalysisRun_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE,
  CONSTRAINT "AnalysisRun_mode_check" CHECK ("mode" IN ('OFFER', 'LISTING')),
  CONSTRAINT "AnalysisRun_status_check" CHECK ("status" IN ('RUNNING', 'SUCCEEDED', 'FAILED'))
);
CREATE UNIQUE INDEX "AnalysisRun_requestKey_key" ON "AnalysisRun"("requestKey");
CREATE UNIQUE INDEX "AnalysisRun_one_running_input" ON "AnalysisRun"("propertyId", "mode", "inputHash") WHERE "status" = 'RUNNING';
CREATE INDEX "AnalysisRun_propertyId_mode_createdAt_idx" ON "AnalysisRun"("propertyId", "mode", "createdAt" DESC);
CREATE INDEX "AnalysisRun_propertyId_mode_inputHash_status_idx" ON "AnalysisRun"("propertyId", "mode", "inputHash", "status");
