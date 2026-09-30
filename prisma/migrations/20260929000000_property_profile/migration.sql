CREATE TABLE "Property" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider" TEXT NOT NULL,
  "providerPropertyId" TEXT,
  "normalizedAddressKey" TEXT NOT NULL,
  "formattedAddress" TEXT NOT NULL,
  "addressLine1" TEXT NOT NULL,
  "unit" TEXT,
  "city" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "zipCode" TEXT NOT NULL,
  "latitude" DECIMAL(10,7),
  "longitude" DECIMAL(10,7),
  "propertyType" TEXT,
  "bedrooms" DECIMAL(5,2),
  "bathrooms" DECIMAL(5,2),
  "livingAreaSqft" INTEGER,
  "lotSizeSqft" INTEGER,
  "yearBuilt" INTEGER,
  "currentListPrice" DECIMAL(14,2),
  "notes" TEXT,
  "userOverrides" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DataSnapshot" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "propertyId" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "fetchedAt" TIMESTAMPTZ(6) NOT NULL,
  "sourceDataAsOf" TIMESTAMPTZ(6),
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "queryHash" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "normalizedPayload" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DataSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DataSnapshot_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Property_normalizedAddressKey_key" ON "Property"("normalizedAddressKey");
CREATE UNIQUE INDEX "Property_provider_providerPropertyId_key" ON "Property"("provider", "providerPropertyId");
CREATE INDEX "Property_updatedAt_idx" ON "Property"("updatedAt");
CREATE INDEX "Property_formattedAddress_idx" ON "Property"("formattedAddress");
CREATE INDEX "DataSnapshot_propertyId_kind_fetchedAt_idx" ON "DataSnapshot"("propertyId", "kind", "fetchedAt" DESC);
CREATE INDEX "DataSnapshot_expiresAt_idx" ON "DataSnapshot"("expiresAt");
