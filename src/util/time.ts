export function nowMs(): number {
  return Date.now();
}

export function dayKeyUTC(ms: number = Date.now()): string {
  return new Date(ms).toISOString().slice(0, 10);
}
