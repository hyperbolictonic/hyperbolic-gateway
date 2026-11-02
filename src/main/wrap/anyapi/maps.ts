/**
 * Read the wrapper directory through `anyapi-to-mcp`'s map loader.
 *
 * This is the read-only half of the migration: wrappers are projected to maps
 * without touching the files, and the result feeds the new runtime once the
 * adapters are complete. The old executor does not consume this yet.
 */

import { loadLocation } from 'anyapi-to-mcp/map';
import type { MapDocument, MapLoadIssue } from 'anyapi-to-mcp/map';

export type WrapMapProjection = {
  readonly maps: readonly MapDocument[];
  readonly issues: readonly MapLoadIssue[];
};

/** `wrappersDir` is the `<userData>/wrap/wrappers` directory. */
export async function projectWrapMaps(wrappersDir: string): Promise<WrapMapProjection> {
  const issues: MapLoadIssue[] = [];
  const maps = await loadLocation({ path: wrappersDir }, issues);
  return { maps, issues };
}
