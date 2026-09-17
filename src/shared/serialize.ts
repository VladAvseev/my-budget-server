export function toNumberOrNull(value: string | null): number | null {
  return value === null ? null : Number(value);
}

export function toNumber(value: string): number {
  return Number(value);
}

export function toIsoString(value: Date): string {
  return value.toISOString();
}
