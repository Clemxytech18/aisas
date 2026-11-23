import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  ScrollView,
  ActivityIndicator,
  Linking,
} from "react-native";
import { X, ChevronDown, ExternalLink } from "lucide-react-native";
import { auditUrl, type AuditReport } from "../audits";
export type AuditTheme = {
  bg: string;
  panel: string;
  raised: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  soft: string;
  danger: string;
};
export function AuditButton({
  t,
  children,
  onPress,
  secondary = false,
  disabled = false,
  busy = false,
}: any) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={onPress}
      style={{
        minHeight: 44,
        paddingVertical: 11,
        paddingHorizontal: 15,
        borderWidth: 1,
        borderColor: secondary ? t.border : t.accent,
        borderRadius: 9,
        backgroundColor: secondary ? t.raised : t.accent,
        opacity: disabled || busy ? 0.5 : 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      }}
    >
      {busy && (
        <ActivityIndicator color={secondary ? t.accent : t.accentText} />
      )}
      <Text
        style={{
          fontSize: 14,
          fontWeight: "600",
          color: secondary ? t.text : t.accentText,
        }}
      >
        {children}
      </Text>
    </Pressable>
  );
}
export function AuditFieldInput({
  t,
  label,
  value,
  onChangeText,
  error,
  multiline = false,
  ...props
}: any) {
  return (
    <View style={{ gap: 7, flexGrow: 1 }}>
      <Text style={{ color: t.text, fontSize: 14, fontWeight: "500" }}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        placeholderTextColor={t.muted}
        style={{
          color: t.text,
          fontSize: 16,
          lineHeight: 24,
          padding: 12,
          borderRadius: 9,
          borderWidth: 1,
          borderColor: error ? t.danger : t.border,
          backgroundColor: t.bg,
          minHeight: multiline ? 95 : 46,
          textAlignVertical: multiline ? "top" : "center",
        }}
        {...props}
      />
      {!!error && (
        <Text style={{ color: t.danger, fontSize: 13 }}>{error}</Text>
      )}
    </View>
  );
}
export function AuditDialog({
  t,
  title,
  children,
  onClose,
  wide = false,
}: any) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: "#000a",
          justifyContent: "center",
          padding: 16,
        }}
      >
        <View
          accessibilityViewIsModal
          style={{
            width: "100%",
            maxWidth: wide ? 1000 : 700,
            maxHeight: "94%",
            alignSelf: "center",
            backgroundColor: t.panel,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: t.border,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              padding: 20,
              borderBottomWidth: 1,
              borderColor: t.border,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
            }}
          >
            <Text
              style={{
                color: t.text,
                fontSize: 22,
                fontWeight: "600",
                flex: 1,
              }}
            >
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close Audits dialog"
              onPress={onClose}
              style={{ padding: 9 }}
            >
              <X color={t.muted} size={22} />
            </Pressable>
          </View>
          <ScrollView
            key={title}
            contentContainerStyle={{ padding: 20, gap: 18 }}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
export function AuditSelect({ t, label, value, options, onChange }: any) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 7, flexGrow: 1 }}>
      <Text style={{ color: t.text, fontSize: 14 }}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${options.find((o: any) => o.value === value)?.label || "Choose"}`}
        onPress={() => setOpen(true)}
        style={{
          borderWidth: 1,
          borderColor: t.border,
          borderRadius: 9,
          padding: 13,
          minHeight: 46,
          flexDirection: "row",
          gap: 10,
          alignItems: "center",
          backgroundColor: t.bg,
        }}
      >
        <Text style={{ color: t.text, fontSize: 15, flex: 1 }}>
          {options.find((o: any) => o.value === value)?.label || "Choose"}
        </Text>
        <ChevronDown size={17} color={t.muted} />
      </Pressable>
      {open && (
        <AuditDialog t={t} title={label} onClose={() => setOpen(false)}>
          {options.map((o: any) => (
            <AuditButton
              key={String(o.value)}
              t={t}
              secondary={o.value !== value}
              onPress={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              {o.label}
            </AuditButton>
          ))}
        </AuditDialog>
      )}
    </View>
  );
}
export function AuditReportView({
  report,
  t,
}: {
  report: AuditReport;
  t: AuditTheme;
}) {
  return (
    <View style={{ gap: 18 }}>
      <Text style={{ color: t.muted, fontSize: 14, lineHeight: 22 }}>
        {report.audited_at
          ? `Audited ${new Date(report.audited_at).toLocaleString()}`
          : "Audit not completed"}{" "}
        · Qualitative public-content assessment
      </Text>
      {report.status !== "completed" && (
        <Text style={{ color: t.danger, fontSize: 15 }}>
          {report.last_error ||
            "This lead’s audit is not complete. Earlier results may be out of date."}
        </Text>
      )}
      {[
        ["CRO performance", report.cro_performance],
        ["Social performance", report.social_performance],
        ["Issues", report.issues],
        ["Best Offer", report.best_offer],
      ].map(([title, value]) => (
        <View
          key={title}
          style={{
            padding: 17,
            gap: 10,
            backgroundColor: title === "Best Offer" ? t.soft : t.raised,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: t.border,
          }}
        >
          <Text
            style={{
              fontSize: 17,
              fontWeight: "600",
              color: title === "Best Offer" ? t.accent : t.text,
            }}
          >
            {title}
          </Text>
          <Text
            selectable
            style={{ fontSize: 16, lineHeight: 25, color: t.text }}
          >
            {value || "Not assessed yet."}
          </Text>
        </View>
      ))}
      {!!report.findings?.length && (
        <View style={{ gap: 12 }}>
          <Text style={{ fontSize: 18, fontWeight: "600", color: t.text }}>
            Evidence and services
          </Text>
          {report.findings.map((f, i) => (
            <View
              key={i}
              style={{
                padding: 14,
                borderWidth: 1,
                borderColor: t.border,
                borderRadius: 9,
                gap: 8,
              }}
            >
              <Text style={{ color: t.text, fontSize: 15, fontWeight: "600" }}>
                {f.issue}
              </Text>
              <Text
                selectable
                style={{ color: t.muted, fontSize: 14, lineHeight: 22 }}
              >
                “{f.quote}”
              </Text>
              <Text style={{ color: t.text, fontSize: 15, lineHeight: 23 }}>
                Suggested service: {f.solution}
              </Text>
            </View>
          ))}
        </View>
      )}
      <View style={{ gap: 10 }}>
        <Text style={{ fontSize: 18, fontWeight: "600", color: t.text }}>
          Sources checked
        </Text>
        {(report.evidence || []).map((s) => (
          <Pressable
            key={s.id}
            accessibilityRole="link"
            disabled={!auditUrl(s.url)}
            onPress={() => void Linking.openURL(s.url)}
            style={{
              paddingVertical: 10,
              gap: 6,
              borderBottomWidth: 1,
              borderColor: t.border,
            }}
          >
            <View
              style={{ flexDirection: "row", gap: 7, alignItems: "center" }}
            >
              <Text
                style={{
                  color: t.accent,
                  fontSize: 14,
                  lineHeight: 21,
                  flex: 1,
                }}
              >
                {s.url}
              </Text>
              <ExternalLink size={13} color={t.accent} />
            </View>
            <Text style={{ color: t.muted, fontSize: 13 }}>
              {s.area.toUpperCase()} · {s.status}
              {s.title ? ` · ${s.title}` : ""}
            </Text>
          </Pressable>
        ))}
      </View>
      {(report.limitations || []).map((l, i) => (
        <Text key={i} style={{ color: t.muted, fontSize: 14, lineHeight: 22 }}>
          {l}
        </Text>
      ))}
    </View>
  );
}
