import React from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Linking,
} from "react-native";
import { CheckCircle2, XCircle, HelpCircle } from "lucide-react-native";
import {
  verificationForEmail,
  verificationDescription,
  type EmailVerificationFields,
} from "../email-verification";
type Props = {
  lead: { id: string; email: string } & EmailVerificationFields;
  theme: {
    text: string;
    muted: string;
    accent: string;
    border: string;
    blue: string;
    danger: string;
  };
  pending: boolean;
  error?: string;
  onVerify: () => void;
};
export function EmailVerificationControl({
  lead,
  theme: t,
  pending,
  error,
  onVerify,
}: Props) {
  if (!lead.email) return null;
  const status = verificationForEmail(lead);
  const color =
    status === "verified"
      ? t.accent
      : status === "invalid"
        ? t.danger
        : t.muted;
  const Icon =
    status === "verified"
      ? CheckCircle2
      : status === "invalid"
        ? XCircle
        : HelpCircle;
  const checked = lead.email_verification_checked_at;
  return (
    <View style={{ gap: 7, flexShrink: 1, alignItems: "flex-start" }}>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 9,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${status === "unverified" ? "Verify" : "Reverify"} ${lead.email}`}
          accessibilityState={{ disabled: pending, busy: pending }}
          disabled={pending}
          hitSlop={8}
          onPress={onVerify}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            paddingHorizontal: 9,
            paddingVertical: 6,
            borderRadius: 5,
            borderWidth: 1,
            borderColor: t.border,
            opacity: pending ? 0.7 : pressed ? 0.8 : 1,
          })}
        >
          {pending && <ActivityIndicator size="small" color={t.accent} />}
          <Text style={{ fontSize: 10, fontWeight: "600", color: t.accent }}>
            {pending
              ? "Verifying…"
              : status === "unverified"
                ? "Verify"
                : "Reverify"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          onPress={() => Linking.openURL(`mailto:${lead.email}`)}
        >
          <Text selectable style={{ fontSize: 11, color: t.blue }}>
            {lead.email}
          </Text>
        </Pressable>
      </View>
      {status !== "unverified" && !pending && (
        <View
          accessibilityLiveRegion="polite"
          style={{ flexDirection: "row", alignItems: "center", gap: 5 }}
        >
          <Icon size={12} color={color} />
          <Text
            accessibilityLabel={`${status}. ${verificationDescription(lead.email_verification_reason)}${checked ? " Last checked " + new Date(checked).toLocaleString() : ""}`}
            style={{ fontSize: 10, color }}
          >
            {status === "verified"
              ? "Verified"
              : status === "invalid"
                ? "Invalid"
                : "Unknown"}
            {checked ? " · " + new Date(checked).toLocaleString() : ""}
          </Text>
        </View>
      )}
      {status === "unknown" && !pending && (
        <Text
          style={{
            fontSize: 10,
            color: t.muted,
            lineHeight: 16,
            maxWidth: 340,
          }}
        >
          {verificationDescription(lead.email_verification_reason)}
        </Text>
      )}
      {!!error && (
        <Text
          accessibilityRole="alert"
          style={{
            fontSize: 10,
            lineHeight: 16,
            color: t.danger,
            maxWidth: 340,
          }}
        >
          {error}
        </Text>
      )}
    </View>
  );
}
