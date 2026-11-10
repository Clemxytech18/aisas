export type EmailVerificationStatus =
  | "unverified"
  | "verified"
  | "invalid"
  | "unknown";
export type EmailVerificationFields = {
  email_verification_status?: EmailVerificationStatus;
  email_verification_checked_at?: string | null;
  email_verification_address?: string | null;
  email_verification_reason?: string | null;
  email_verification_provider?: string | null;
};
/** Conservative local rejection only. Mailbox existence always needs a provider. */
export function emailProblem(email: string): string | null {
  const value = email.trim();
  const at = value.lastIndexOf("@");
  if (
    !value ||
    value.length > 254 ||
    /[\r\n\x00-\x1f\x7f]/.test(value) ||
    at <= 0 ||
    at === value.length - 1
  )
    return "invalid_format";
  const local = value.slice(0, at),
    domain = value.slice(at + 1).toLowerCase();
  const quoted = local.startsWith('"') && local.endsWith('"');
  if (
    (!quoted &&
      (/[\s@]/.test(local) ||
        local.startsWith(".") ||
        local.endsWith(".") ||
        local.includes(".."))) ||
    /\s/.test(domain)
  )
    return "invalid_format";
  if (
    domain === "localhost" ||
    /\.(example|invalid|test|localhost)$/.test(domain) ||
    ["example.com", "example.net", "example.org"].includes(domain)
  )
    return "reserved_domain";
  return null;
}
export function verificationForEmail(
  lead: { email: string } & EmailVerificationFields,
): EmailVerificationStatus {
  return lead.email_verification_address === lead.email
    ? lead.email_verification_status || "unverified"
    : "unverified";
}
export function verificationDescription(reason?: string | null): string {
  const messages: Record<string, string> = {
    valid: "The verification provider confirmed this inbox can receive email.",
    invalid: "The verification provider reports this address is invalid.",
    invalid_format: "This email address has an invalid format.",
    reserved_domain: "This address uses a reserved demonstration domain.",
    catch_all:
      "This domain accepts all addresses, so this inbox could not be confirmed.",
    risky: "The provider flagged this address as risky for outreach.",
    unknown: "The provider could not confirm this inbox. You can retry later.",
    demo_no_live_check: "Demo mode does not perform live inbox verification.",
  };
  return messages[reason || ""] || messages.unknown;
}
