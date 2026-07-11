export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export function assertPassword(password: string): string {
  const p = String(password ?? "");
  if (p.length < PASSWORD_MIN) throw new Error("password too short");
  if (p.length > PASSWORD_MAX) throw new Error("password too long");
  return p;
}
