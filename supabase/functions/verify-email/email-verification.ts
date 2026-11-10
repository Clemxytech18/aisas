import {
  emailProblem,
  type EmailVerificationStatus,
} from "../../../src/email-verification.ts";
export class EmailVerificationError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "EmailVerificationError";
  }
}
export type VerificationResult = {
  status: Exclude<EmailVerificationStatus, "unverified">;
  reason: string;
  provider: string;
};
export function mapVerificationResponse(
  data: Record<string, unknown>,
): VerificationResult {
  if (data.status === "valid")
    return { status: "verified", reason: "valid", provider: "zerobounce" };
  if (data.status === "invalid")
    return { status: "invalid", reason: "invalid", provider: "zerobounce" };
  if (data.status === "catch-all")
    return { status: "unknown", reason: "catch_all", provider: "zerobounce" };
  if (["spamtrap", "abuse", "do_not_mail"].includes(String(data.status)))
    return { status: "unknown", reason: "risky", provider: "zerobounce" };
  if (data.status === "unknown")
    return { status: "unknown", reason: "unknown", provider: "zerobounce" };
  throw new EmailVerificationError(
    "Email verification could not be completed. Check the verifier account or try again later.",
    502,
    "provider_error",
  );
}
export async function verifyEmailAddress(
  email: string,
  apiKey: string | undefined,
  request: typeof fetch = fetch,
): Promise<VerificationResult> {
  const problem = emailProblem(email);
  if (problem)
    return { status: "invalid", reason: problem, provider: "format" };
  if (!apiKey)
    throw new EmailVerificationError(
      "Live email verification is not configured yet. Your administrator needs to add the ZeroBounce API key.",
      503,
      "verification_not_configured",
    );
  let response: Response;
  try {
    response = await request("https://api.zerobounce.net/v2/validate", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        api_key: apiKey,
        email: email.trim(),
        ip_address: "",
      }),
      signal: AbortSignal.timeout(35_000),
    });
  } catch {
    throw new EmailVerificationError(
      "The email verification service did not respond. Please try again.",
      502,
      "provider_unavailable",
    );
  }
  if (!response.ok)
    throw new EmailVerificationError(
      "The email verification service is unavailable. Please try again later.",
      502,
      "provider_unavailable",
    );
  let data: Record<string, unknown>;
  try {
    data = await response.json();
  } catch {
    throw new EmailVerificationError(
      "The email verification service returned an unreadable response.",
      502,
      "provider_error",
    );
  }
  if (!data || typeof data !== "object" || data.error)
    throw new EmailVerificationError(
      "Email verification could not be completed. Check the verifier account or try again later.",
      502,
      "provider_error",
    );
  if (
    typeof data.address !== "string" ||
    data.address.trim().toLowerCase() !== email.trim().toLowerCase()
  )
    throw new EmailVerificationError(
      "The verification service returned a result for a different address. Please retry.",
      502,
      "address_mismatch",
    );
  return mapVerificationResponse(data);
}
