import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { Platform, AppState } from "react-native";
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
    action === "verify-email" ? "verify-email" : action === "scout" ? "scout-search" : "aisas-api",
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
