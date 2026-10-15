import { parseCatalog, parseCatalogRelease } from '@food-education/catalog-core';
import snapshot from './catalog.json';
import release from './catalog-release.json';

// JSON is an external boundary even when it is bundled with the application.
export const catalogResult = parseCatalog(snapshot);
export const catalogRelease = catalogResult.ok ? parseCatalogRelease(release, catalogResult.catalog.contentVersion) : null;
