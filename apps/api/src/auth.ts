import { createHmac, timingSafeEqual } from "node:crypto";
import type { Role } from "@studio/contracts";
export type Claims = {
  role: Role;
  studio: string;
  identity: string;
  name: string;
  expires: number;
  purpose: "session" | "invite" | "media" | "render";
};
export class Auth {
  constructor(private secret: string) {}
  sign(claims: Claims): string {
    if (this.secret.length < 32) throw new Error("SESSION_SECRET is not configured.");
    const data = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return `${data}.${createHmac("sha256", this.secret).update(data).digest("base64url")}`;
  }
  verify(token: unknown, purposes: Claims["purpose"][]): Claims | null {
    if (typeof token !== "string" || this.secret.length < 32 || token.length > 4096) return null;
    const [data, signature, ...extra] = token.split(".");
    if (!data || !signature || extra.length) return null;
    const expected = createHmac("sha256", this.secret).update(data).digest();
    const provided = Buffer.from(signature, "base64url");
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
    try {
      const c = JSON.parse(Buffer.from(data, "base64url").toString()) as Claims;
      if (
        !["host", "guest", "renderer"].includes(c.role) ||
        !purposes.includes(c.purpose) ||
        typeof c.expires !== "number" ||
        c.expires <= Date.now() ||
        typeof c.studio !== "string" ||
        typeof c.identity !== "string" ||
        typeof c.name !== "string"
      )
        return null;
      return c;
    } catch {
      return null;
    }
  }
}
export function matchesPasscode(actual: string, supplied: string): boolean {
  const a = createHmac("sha256", "passcode-comparison").update(actual).digest();
  const b = createHmac("sha256", "passcode-comparison").update(supplied).digest();
  return actual.length >= 8 && !actual.startsWith("replace-") && timingSafeEqual(a, b);
}
