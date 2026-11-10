import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  Platform,
  Linking,
} from "react-native";
import { ArrowRight, CheckCircle2 } from "lucide-react-native";
import { supabase } from "../supabase";
import { PasswordField } from "./PasswordField";
import {
  PASSWORD_RESET_REDIRECT,
  requestPasswordReset,
  updateRecoveredPassword,
  validateAuthEmail,
  type AuthMode,
} from "../auth-flow";
type Props = {
  mode: AuthMode;
  recoveryUserId: string | null;
  recoveryLoading: boolean;
  linkError?: string | null;
  t: {
    bg: string;
    border: string;
    text: string;
    muted: string;
    accent: string;
    accentText: string;
    danger: string;
    soft: string;
  };
  onModeChange: (mode: AuthMode) => void;
  onBusyChange: (busy: boolean) => void;
  onSignedIn: () => void;
  onPasswordUpdated: () => void;
  onCancelRecovery: (mode: "signin" | "forgot") => Promise<void>;
};
export function AuthForm({
  mode,
  recoveryUserId,
  recoveryLoading,
  linkError,
  t,
  onModeChange,
  onBusyChange,
  onSignedIn,
  onPasswordUpdated,
  onCancelRecovery,
}: Props) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [sent, setSent] = useState(false);
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  const officialBrowser =
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    window.location.origin === new URL(PASSWORD_RESET_REDIRECT).origin;
  useEffect(() => {
    setPassword("");
    setConfirmation("");
    setError("");
    setMessage("");
    setSent(false);
  }, [mode]);
  const copy = { color: t.muted, fontSize: 13, lineHeight: 23 } as const;
  async function changeMode(next: AuthMode) {
    if (busy) return;
    if (mode === "reset" && recoveryUserId) {
      setBusy(true);
      setError("");
      try {
        await onCancelRecovery(next === "forgot" ? "forgot" : "signin");
      } catch {
        setError("Could not close the recovery session. Please try again.");
      } finally {
        setBusy(false);
      }
    } else onModeChange(next);
  }
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (mode === "forgot") {
        setMessage(await requestPasswordReset(supabase.auth, email));
        setSent(true);
        return;
      }
      if (mode === "reset") {
        await updateRecoveredPassword(
          supabase.auth,
          recoveryUserId,
          password,
          confirmation,
        );
        setPassword("");
        setConfirmation("");
        onPasswordUpdated();
        return;
      }
      const address = validateAuthEmail(email);
      if (!password) throw new Error("Enter your password.");
      if (mode === "signup" && password.length < 8)
        throw new Error("Use a password with at least 8 characters.");
      const result =
        mode === "signup"
          ? await supabase.auth.signUp({ email: address, password })
          : await supabase.auth.signInWithPassword({
              email: address,
              password,
            });
      if (result.error) throw result.error;
      setPassword("");
      if (mode === "signup" && !result.data.session) {
        setMessage(
          "Check your email to confirm your address before signing in.",
        );
        setSent(true);
      } else onSignedIn();
    } catch (e: any) {
      setError(e.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const link = (label: string, next: AuthMode) => (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={() => void changeMode(next)}
      style={{
        minHeight: 44,
        paddingVertical: 12,
        alignItems: "center",
        justifyContent: "center",
        opacity: busy ? 0.5 : 1,
      }}
    >
      <Text style={{ color: t.muted, fontSize: 12, textAlign: "center" }}>
        {label}
      </Text>
    </Pressable>
  );
  const button = (label: string, action: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      disabled={busy || disabled}
      accessibilityState={{ disabled: busy || disabled }}
      onPress={action}
      style={({ pressed }) => ({
        minHeight: 48,
        borderRadius: 8,
        padding: 14,
        backgroundColor: t.accent,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        opacity: busy || disabled ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator color={t.accentText} />
      ) : (
        <>
          <Text
            style={{ color: t.accentText, fontWeight: "700", fontSize: 13 }}
          >
            {label}
          </Text>
          <ArrowRight size={16} color={t.accentText} />
        </>
      )}
    </Pressable>
  );
  if (mode === "reset" && recoveryLoading)
    return (
      <View style={{ paddingVertical: 24, gap: 16, alignItems: "center" }}>
        <ActivityIndicator color={t.accent} />
        <Text style={copy}>Checking your reset link…</Text>
      </View>
    );
  return (
    <View>
      {!!linkError && (
        <Text
          accessibilityRole="alert"
          style={{
            color: t.danger,
            fontSize: 12,
            lineHeight: 21,
            marginBottom: 18,
          }}
        >
          {linkError}
        </Text>
      )}
      <Text style={[copy, { marginBottom: 22 }]}>
        {mode === "forgot"
          ? "Enter the email you use for AISAS. We’ll send you a link to choose a new password."
          : mode === "reset"
            ? "Choose a new password for your AISAS account. Use at least 8 characters."
            : "Your audience. Your campaigns. Your next chapter of growth."}
      </Text>
      {!!error && (
        <Text
          accessibilityRole="alert"
          style={{
            color: t.danger,
            fontSize: 12,
            lineHeight: 21,
            marginBottom: 18,
          }}
        >
          {error}
        </Text>
      )}
      {!!message && (
        <View
          accessibilityRole="alert"
          style={{
            padding: 16,
            borderRadius: 9,
            backgroundColor: t.soft,
            marginBottom: 18,
            gap: 9,
          }}
        >
          <CheckCircle2 size={20} color={t.accent} />
          <Text style={{ color: t.text, fontSize: 12, lineHeight: 22 }}>
            {message}
          </Text>
        </View>
      )}
      {mode === "forgot" && !officialBrowser ? (
        <>
          <Text style={[copy, { marginBottom: 20 }]}>
            Complete password recovery securely on the AISAS website in your
            browser.
          </Text>
          {button(
            "Open password recovery",
            () => void Linking.openURL(`${PASSWORD_RESET_REDIRECT}?forgot=1`),
          )}
          {link("Back to sign in", "signin")}
        </>
      ) : mode === "reset" ? (
        !recoveryUserId ? (
          <>
            <Text
              accessibilityRole="alert"
              style={[copy, { marginBottom: 20 }]}
            >
              This reset link is invalid, expired, or was opened in a different
              browser. Request a new email here and open its link in this
              browser.
            </Text>
            {button(
              "Request a new reset link",
              () => void changeMode("forgot"),
            )}
            {link("Back to sign in", "signin")}
          </>
        ) : (
          <>
            <PasswordField
              key="new-password"
              t={t}
              label="New password"
              value={password}
              onChangeText={setPassword}
              autoComplete="new-password"
              textContentType="newPassword"
              editable={!busy}
              placeholder="At least 8 characters"
            />
            <PasswordField
              key="confirm-password"
              t={t}
              label="Confirm new password"
              value={confirmation}
              onChangeText={setConfirmation}
              autoComplete="new-password"
              textContentType="newPassword"
              editable={!busy}
              placeholder="Enter your new password again"
              returnKeyType="done"
              onSubmitEditing={() => void submit()}
            />
            {button("Update password", () => void submit())}
            {link("Cancel and return to sign in", "signin")}
          </>
        )
      ) : (
        <>
          {!sent && (
            <>
              <View style={{ gap: 8, marginBottom: 18 }}>
                <Text style={{ color: t.muted, fontSize: 12 }}>
                  Email address
                </Text>
                <TextInput
                  accessibilityLabel="Email address"
                  value={email}
                  onChangeText={setEmail}
                  editable={!busy}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="emailAddress"
                  keyboardType="email-address"
                  returnKeyType={mode === "forgot" ? "send" : "next"}
                  onSubmitEditing={
                    mode === "forgot" ? () => void submit() : undefined
                  }
                  placeholder="you@company.com"
                  placeholderTextColor={t.muted}
                  style={{
                    minHeight: 48,
                    paddingHorizontal: 14,
                    paddingVertical: 13,
                    borderWidth: 1,
                    borderColor: t.border,
                    borderRadius: 8,
                    color: t.text,
                    backgroundColor: t.bg,
                    fontSize: 13,
                  }}
                />
              </View>
              {mode !== "forgot" && (
                <PasswordField
                  key={`${mode}-password`}
                  t={t}
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  editable={!busy}
                  autoComplete={
                    mode === "signup" ? "new-password" : "current-password"
                  }
                  textContentType={
                    mode === "signup" ? "newPassword" : "password"
                  }
                  placeholder={
                    mode === "signup"
                      ? "At least 8 characters"
                      : "Your password"
                  }
                  returnKeyType="go"
                  onSubmitEditing={() => void submit()}
                />
              )}
              {mode === "signin" && (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => void changeMode("forgot")}
                  style={{
                    minHeight: 44,
                    alignSelf: "flex-end",
                    justifyContent: "center",
                    marginTop: -8,
                    marginBottom: 12,
                    paddingHorizontal: 4,
                  }}
                >
                  <Text
                    style={{ color: t.accent, fontSize: 12, fontWeight: "600" }}
                  >
                    Forgot password?
                  </Text>
                </Pressable>
              )}
              {button(
                mode === "forgot"
                  ? "Send reset link"
                  : mode === "signup"
                    ? "Create account"
                    : "Sign in",
                () => void submit(),
              )}
            </>
          )}
          {mode === "forgot" ? (
            <>
              {sent && (
                <Text style={[copy, { fontSize: 11, marginBottom: 12 }]}>
                  Check your inbox and spam folder. Email delivery can take a
                  few minutes.
                </Text>
              )}
              {link("Back to sign in", "signin")}
              {sent && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setSent(false);
                    setMessage("");
                  }}
                  style={{ padding: 12, alignItems: "center" }}
                >
                  <Text style={{ color: t.muted, fontSize: 12 }}>
                    Use another email address
                  </Text>
                </Pressable>
              )}
            </>
          ) : (
            link(
              mode === "signup"
                ? "Already have an account? Sign in"
                : "New here? Create an account",
              mode === "signup" ? "signin" : "signup",
            )
          )}
        </>
      )}
    </View>
  );
}
