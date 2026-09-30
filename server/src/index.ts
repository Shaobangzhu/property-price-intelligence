import { createApp } from './app.js';
import { loadServerEnv, parseServerConfig } from './config/env.js';
import { createDatabase } from './infrastructure/database.js';
import { PgPropertyRepository } from './properties/pg-repository.js';
import { RentCastPropertyProvider } from './properties/provider.js';
import { PropertyService, parseProfileTtlDays } from './properties/service.js';
import { PgMarketRepository } from './market/repository.js';
import { RentCastMarketProvider } from './market/provider.js';
import { MarketEvidenceService, parseMarketPolicy } from './market/service.js';
import { AssignedSchoolsService, UnavailableAssignmentSource } from './context/schools.js';
import { ArcGisPlacesProvider, GroceryContextService, parseGroceryPolicy } from './context/grocery.js';
import { CalFireWildfireProvider, CgsFaultProvider, HazardContextService } from './context/hazards.js';
import { PricingPreviewService } from './pricing/service.js';
import { PgAnalysisRepository } from './analysis/repository.js';
import { OpenAIExplanationModel } from './analysis/explanation.js';
import { AnalysisService } from './analysis/service.js';

async function main() {
  const config = parseServerConfig(loadServerEnv());
  if (!config.DATABASE_URL) throw new Error('DATABASE_URL missing');
  const db = createDatabase(config.DATABASE_URL);
  const propertyRepository = new PgPropertyRepository(db.pool);
  const propertyService = new PropertyService(propertyRepository, new RentCastPropertyProvider(config.RENTCAST_API_KEY), undefined, parseProfileTtlDays(process.env));
  const marketService = new MarketEvidenceService(propertyRepository, new PgMarketRepository(db.pool), new RentCastMarketProvider(config.RENTCAST_API_KEY), parseMarketPolicy(process.env));
  const schoolsService = new AssignedSchoolsService(propertyRepository, new UnavailableAssignmentSource());
  const groceryService = new GroceryContextService(propertyRepository, new ArcGisPlacesProvider(config.ARCGIS_PLACES_API_KEY), parseGroceryPolicy(process.env));
  const hazardService = new HazardContextService(propertyRepository, new CalFireWildfireProvider(), new CgsFaultProvider());
  const pricingService = new PricingPreviewService(propertyService, marketService);
  const analysisService = new AnalysisService(pricingService, new PgAnalysisRepository(db.pool),
    new OpenAIExplanationModel(config.OPENAI_API_KEY, config.OPENAI_MODEL, config.OPENAI_REASONING_EFFORT), config.OPENAI_MODEL, config.OPENAI_REASONING_EFFORT);
  const app = createApp({ checkDatabase: db.check, origins: config.origins, propertyService, marketService, schoolsService, groceryService, hazardService, pricingService, analysisService, log: entry => process.stderr.write(JSON.stringify(entry) + '\n') });
  const server = app.listen(config.PORT, config.HOST, () => process.stdout.write(`PPI API listening on ${config.HOST}:${config.PORT}\n`));
  let closing = false;
  const shutdown = () => { if (closing) return; closing = true; server.close(async () => { await db.close(); process.exitCode = 0; }); setTimeout(() => { process.exitCode = 1; server.closeAllConnections(); }, 5000).unref(); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
main().catch(() => { process.stderr.write('PPI API could not start: check local configuration\n'); process.exitCode = 1; });
