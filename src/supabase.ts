import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  recoveryMarker,
  recoveryUser,
  RECOVERY_STORAGE_KEY,
  type RecoveryMarker,
} from "./auth-flow";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { Platform, AppState } from "react-native";
export const initialAuthHref =
  Platform.OS === "web" && typeof window !== "undefined"
    ? window.location.href
    : undefined;
let recoveryAtBoot: RecoveryMarker | null = null;
export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "https://beslhrcwojbxbqcvsnhy.supabase.co",
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    "sb_publishable_2jkgzpNlJAvzwcT2Bw-MSg_MglOPXkg",
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === "web",
      flowType: "pkce",
    },
  },
);
// Register before the app mounts so an early PASSWORD_RECOVERY event is not lost.
// These markers restore the form only; password updates still require server-validated auth.
supabase.auth.onAuthStateChange((event, session) => {
  if (event === "PASSWORD_RECOVERY" && session) {
    recoveryAtBoot = recoveryMarker(session.user.id);
    void AsyncStorage.setItem(
      RECOVERY_STORAGE_KEY,
      JSON.stringify(recoveryAtBoot),
    ).catch(() => {});
  }
  if (event === "SIGNED_OUT") {
    recoveryAtBoot = null;
    void AsyncStorage.removeItem(RECOVERY_STORAGE_KEY).catch(() => {});
  }
});
export async function pendingRecoveryUser(
  session: Session | null,
): Promise<string | null> {
  if (!session) return null;
  const marker =
    recoveryAtBoot ||
    (await AsyncStorage.getItem(RECOVERY_STORAGE_KEY).catch(() => null));
  return recoveryUser(marker, session.user.id);
}
export async function clearPendingRecovery(): Promise<void> {
  recoveryAtBoot = null;
  await AsyncStorage.removeItem(RECOVERY_STORAGE_KEY).catch(() => {});
}
if (Platform.OS !== "web")
  AppState.addEventListener("change", (state) =>
    state === "active"
      ? supabase.auth.startAutoRefresh()
      : supabase.auth.stopAutoRefresh(),
  );
export async function api(
  action: string,
  payload: Record<string, unknown> = {},
) {
  const { data, error } = await supabase.functions.invoke(
    action === "verify-email"
      ? "verify-email"
      : action === "scout"
        ? "scout-search"
        : action === "generate-sequence"
          ? "sequence-writer"
          : "aisas-api",
    {
      body: action === "verify-email" ? payload : { action, ...payload },
    },
  );
  if (error) {
    let detail = error.message;
    try {
      detail = (await error.context.json()).error || detail;
    } catch {}
    throw new Error(detail);
  }
  if (data.error) throw new Error(data.error);
  return data;
}
