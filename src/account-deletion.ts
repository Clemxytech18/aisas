// Server-side orchestration. Credentials and the target ID come from validated auth.
export type DeleteDependencies = {
  reauthenticate: (password: string) => Promise<boolean>;
  revokeSessions: () => Promise<void>;
  freeze: () => Promise<void>;
  unfreeze: () => Promise<void>;
  pauseAndGetGrants: () => Promise<string[]>;
  removeImages: () => Promise<void>;
  revokeGrant: (grant: string) => Promise<void>;
  purgeEvents: () => Promise<void>;
  deleteUser: () => Promise<void>;
};
export function validateDeletionRequest(body: unknown): { password: string } {
  if (!body || typeof body !== "object")
    throw new Error("Confirm account deletion before continuing.");
  const value = body as Record<string, unknown>;
  if (
    value.confirmation !== "DELETE" ||
    typeof value.password !== "string" ||
    !value.password ||
    value.password.length > 1024
  )
    throw new Error("Type DELETE and enter your current password to confirm.");
  return { password: value.password };
}
export async function deleteOwnAccount(
  body: unknown,
  deps: DeleteDependencies,
): Promise<void> {
  const { password } = validateDeletionRequest(body);
  if (!(await deps.reauthenticate(password)))
    throw new Error(
      "Your current password is incorrect. Your account was not deleted.",
    );
  await deps.revokeSessions();
  await deps.freeze();
  try {
    const grants = await deps.pauseAndGetGrants();
    await deps.removeImages();
    for (const grant of grants) await deps.revokeGrant(grant);
    await deps.purgeEvents();
    await deps.deleteUser();
  } catch {
    await deps.unfreeze().catch(() => {});
    throw new Error(
      "Account deletion did not complete. Active campaigns were paused for safety. Sign in again and retry, or contact support.",
    );
  }
}
