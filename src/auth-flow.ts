export type AuthMode = "signin" | "signup" | "forgot" | "reset";
export const PASSWORD_RESET_REDIRECT = "https://aisas.clemxytech.com/";
export const RECOVERY_STORAGE_KEY = "aisas.password-recovery.v1";
export type RecoveryMarker = { userId: string; expiresAt: number };
export const recoveryMarker = (
  userId: string,
  now = Date.now(),
): RecoveryMarker => ({ userId, expiresAt: now + 60 * 60 * 1000 });
export function recoveryUser(
  marker: unknown,
  currentUserId: string | undefined,
  now = Date.now(),
): string | null {
  try {
    const data = typeof marker === "string" ? JSON.parse(marker) : marker;
    return data &&
      typeof data.userId === "string" &&
      data.userId === currentUserId &&
      typeof data.expiresAt === "number" &&
      data.expiresAt > now &&
      data.expiresAt <= now + 60 * 60 * 1000
      ? data.userId
      : null;
  } catch {
    return null;
  }
}
export function authLinkError(href?: string): string | null {
  if (!href) return null;
  try {
    const u = new URL(href),
      hash = new URLSearchParams(u.hash.slice(1));
    return [u.searchParams, hash].some(
      (p) => p.has("error") || p.has("error_code"),
    )
      ? "This email link is invalid or has expired. Request a new password reset link, or sign in with your password."
      : null;
  } catch {
    return null;
  }
}
export function unhandledAuthCodeError(href?: string): string | null {
  try {
    return href && new URL(href).searchParams.has("code")
      ? "This email link could not be completed in this browser. Sign in with your password, or request a new reset link here."
      : null;
  } catch {
    return null;
  }
}
export function cleanAuthCallbackUrl(href: string): string {
  const url = new URL(href);
  for (const key of [
    "code",
    "error",
    "error_code",
    "error_description",
    "type",
  ])
    url.searchParams.delete(key);
  url.hash = "";
  return url.pathname + url.search;
}
export function validateAuthEmail(email: string): string {
  const value = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 254)
    throw new Error("Enter a valid email address.");
  return value;
}
type ResetClient = {
  resetPasswordForEmail: (
    email: string,
    options: { redirectTo: string },
  ) => Promise<{ error: { code?: string; status?: number } | null }>;
};
export async function requestPasswordReset(
  client: ResetClient,
  email: string,
): Promise<string> {
  const address = validateAuthEmail(email);
  const { error } = await client.resetPasswordForEmail(address, {
    redirectTo: PASSWORD_RESET_REDIRECT,
  });
  if (error && error.code !== "user_not_found") {
    if (error.status === 429)
      throw new Error(
        "Too many requests. Please wait a minute before trying again.",
      );
    throw new Error(
      "The reset email could not be requested. Please try again shortly.",
    );
  }
  return "If an account exists for this email address, you will receive a password reset link. Open it in this browser to choose a new password.";
}
type PasswordClient = {
  getUser: () => Promise<{
    data: { user: { id: string } | null };
    error: unknown;
  }>;
  updateUser: (attributes: {
    password: string;
  }) => Promise<{ error: { code?: string } | null }>;
};
export async function updateRecoveredPassword(
  client: PasswordClient,
  recoveryUserId: string | null,
  password: string,
  confirmation: string,
): Promise<void> {
  if (!recoveryUserId)
    throw new Error(
      "This reset link is invalid or expired. Request a new reset email.",
    );
  if (password.length < 8)
    throw new Error("Use a password with at least 8 characters.");
  if (password !== confirmation) throw new Error("The passwords do not match.");
  const { data, error } = await client.getUser();
  if (error || !data.user || data.user.id !== recoveryUserId)
    throw new Error(
      "This reset session has expired. Request a new reset email.",
    );
  const result = await client.updateUser({ password });
  if (result.error) {
    if (result.error.code === "same_password")
      throw new Error("Choose a different password from your current one.");
    if (result.error.code === "weak_password")
      throw new Error("Choose a stronger password with at least 8 characters.");
    throw new Error(
      "Your password could not be updated. Please request a new reset link and try again.",
    );
  }
}
