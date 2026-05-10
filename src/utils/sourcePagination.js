import { appConfig } from '../config.js';

/** Max raw listings to fetch per adapter × saved search (pagination depth). */
export function maxRawListingsPerQuery() {
  return appConfig.sourceMaxResultsPerQuery;
}
