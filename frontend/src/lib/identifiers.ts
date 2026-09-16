export function identifierEntries(identifiers?: Record<string, string> | null, legacyMac?: string) {
  const values = { ...(identifiers || {}) };
  if (!values.mac && legacyMac) values.mac = legacyMac;
  return Object.entries(values).filter(([, value]) => value);
}

export function identifierText(identifiers?: Record<string, string> | null, legacyMac?: string) {
  return identifierEntries(identifiers, legacyMac).map(([kind, value]) => `${kind}: ${value}`).join(" · ") || "No secondary identifier";
}
