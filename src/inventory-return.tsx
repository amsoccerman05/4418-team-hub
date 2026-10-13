/** Only a location UUID is accepted, never a URL, origin, path, or auth token. */
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const inventoryLocationParameter = 'inventory_location';
export function scannedInventoryLocation(search: string): string | null {
  const values = new URLSearchParams(search).getAll(inventoryLocationParameter);
  return values.length === 1 && uuid.test(values[0]) ? values[0].toLowerCase() : null;
}
export function inventoryLocationQuery(search: string): string {
  const id = scannedInventoryLocation(search);
  return id ? `?${inventoryLocationParameter}=${id}` : '';
}
export function InventoryLocationReturn() {
  const id = scannedInventoryLocation(location.search);
  if (!id) return null;
  return <section className="inventory-location-return" aria-label="Scanned inventory location">
    <p>Your scanned location is ready.</p>
    <a href={`https://inventory.frc4418.org/#location/${id}`} onClick={event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      // The existing suite-auth document click handler owns the synchronous opener
      // handoff. Consume only the non-secret routing hint after the user's gesture.
      const query = new URLSearchParams(location.search);
      query.delete(inventoryLocationParameter);
      history.replaceState(null, '', location.pathname + (query.size ? `?${query}` : '') + location.hash);
    }}>Continue to scanned inventory location</a>
  </section>;
}
