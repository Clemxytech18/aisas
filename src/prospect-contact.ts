export function phoneDigits(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (c) =>
      String(c.charCodeAt(0) - (c.charCodeAt(0) >= 0x6f0 ? 0x6f0 : 0x660)),
    )
    .replace(/\D/g, "");
}
/** Presence and syntax only; inbox verification remains a separate explicit action. */
export function hasProspectContact(p: {
  email?: string;
  phone?: string;
}): boolean {
  const email = (p.email || "").trim(),
    phone = phoneDigits(p.phone || "");
  return (
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    (phone.length >= 7 && phone.length <= 18)
  );
}
