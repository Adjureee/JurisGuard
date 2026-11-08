/** Source pixels remain unchanged; one transform moves the scan and its evidence. */
export function isScanBox(value: unknown): value is [number, number, number, number] {
  return Array.isArray(value) && value.length === 4 && value.every(Number.isFinite)
    && value[0] >= 0 && value[1] >= 0 && value[2] > value[0] && value[3] > value[1];
}

export function fitScan(width: number, height: number, viewportWidth: number, viewportHeight: number, rotation: number) {
  if (![width, height, viewportWidth, viewportHeight].every(value => Number.isFinite(value) && value > 0)) return 1;
  const sideways = Math.abs(rotation % 180) === 90;
  return Math.min(viewportWidth / (sideways ? height : width), viewportHeight / (sideways ? width : height));
}
