/**
 * Keeps explorer tree icons addressable via the Font Awesome Kit-style
 * {@link byPrefixAndName} lookup so components can write
 * `<FontAwesomeIcon icon={byPrefixAndName.fans['folder']} />` as documented for
 * custom kits. This repository bundles the Classic Solid folder glyph (`fas`
 * `folder`) under the {@link fans} key because the Sharp New Styles (`fans`)
 * icon manifests are shipped through Font Awesome Kits rather than public npm.
 * Swap the implementations here for `import { byPrefixAndName } from
 * "@awesome.me/kit-___/icons"` when a kit is wired for the desktop app.
 */

import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
import { faFolder } from '@fortawesome/free-solid-svg-icons';

/**
 * Mirrors Font Awesome Kit's hierarchical icon index used with
 * `@fortawesome/react-fontawesome`; the `fans` bucket currently aliases the free
 * solid folder icon until a subset from your kit replaces it.
 */
export const byPrefixAndName = {
  fans: {
    folder: faFolder,
  } as Record<string, IconDefinition>,
};
