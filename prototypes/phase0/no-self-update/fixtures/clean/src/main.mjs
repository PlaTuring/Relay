// Prose in comments is not executable policy surface: no updater, latest lookup,
// channel, remote catalog, or runtime package installer exists in this fixture.
export const alphaHelpText =
  "Install a newly signed application version manually; there is no background updater or latest channel.";

export function parseEmbeddedCatalog(serializedCatalog) {
  return JSON.parse(serializedCatalog);
}
