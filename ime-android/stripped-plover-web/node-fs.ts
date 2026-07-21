/**
 * Browser implementation of the one node:fs operation used by Stripped
 * Plover's production graph. The Android asset URL is same-origin and local,
 * so a synchronous request preserves readFileSync semantics during engine
 * construction without exposing arbitrary filesystem access.
 */
export function readFileSync(path: URL | string, encoding: string): string {
  if (encoding !== "utf8" && encoding !== "utf-8") {
    throw new Error(`Unsupported text encoding: ${encoding}`);
  }
  const request = new XMLHttpRequest();
  request.open("GET", String(path), false);
  request.send();
  if (request.status < 200 || request.status >= 300) {
    throw new Error(
      `Could not load bundled Stripped Plover asset: ${request.status}`,
    );
  }
  return request.responseText;
}
