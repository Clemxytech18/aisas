import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Image,
  Modal,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Eye, EyeOff, UserRound, Trash2, X } from "lucide-react-native";
import type { User } from "@supabase/supabase-js";
import { supabase, api } from "../supabase";
import { requestPasswordReset } from "../auth-flow";
import { avatarUrl, uploadProfileImage } from "../profile-images";
import type { EmailSignature } from "../email-signature";
type Palette = {
  bg: string;
  panel: string;
  raised: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  accentText: string;
  danger: string;
};
function Action({
  label,
  onPress,
  t,
  disabled = false,
  danger = false,
}: {
  label: string;
  onPress: () => void;
  t: Palette;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{
        alignSelf: "flex-start",
        opacity: disabled ? 0.5 : 1,
        backgroundColor: danger ? t.danger : t.accent,
        paddingVertical: 12,
        paddingHorizontal: 17,
        borderRadius: 8,
        marginTop: 12,
      }}
    >
      <Text style={{ color: danger ? t.bg : t.accentText, fontWeight: "600" }}>
        {label}
      </Text>
    </Pressable>
  );
}
function Field({ label, t, ...props }: any) {
  return (
    <View style={{ gap: 8, marginTop: 16 }}>
      <Text style={{ color: t.text, fontSize: 13 }}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={t.muted}
        style={{
          color: t.text,
          backgroundColor: t.bg,
          borderColor: t.border,
          borderWidth: 1,
          borderRadius: 8,
          padding: 13,
          minHeight: 46,
          ...props.style,
        }}
      />
    </View>
  );
}
export function SignaturePreview({
  value,
  t,
}: {
  value: EmailSignature;
  t: Palette;
}) {
  if (!value.sender_name && !value.signature_text && !value.signature_image_url)
    return null;
  return (
    <View style={{ gap: 8, marginTop: 14 }}>
      <Text style={{ color: t.text, lineHeight: 22 }}>
        {[value.sender_name, value.signature_text].filter(Boolean).join("\n")}
      </Text>
      {!!value.signature_image_url && (
        <Image
          source={{ uri: value.signature_image_url }}
          accessibilityLabel="Email signatory preview"
          resizeMode="contain"
          style={{
            width: 280,
            maxWidth: "100%",
            height: 90,
            alignSelf: "flex-start",
          }}
        />
      )}
    </View>
  );
}
export function ProfileSignatory({
  value,
  onChange,
  t,
  demo,
  onBusyChange,
}: {
  value: EmailSignature;
  onChange: (v: EmailSignature) => void;
  t: Palette;
  demo: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      onBusyChange?.(false);
    };
  }, [onBusyChange]);
  async function upload() {
    setError("");
    setBusy(true);
    onBusyChange?.(true);
    try {
      const result = await uploadProfileImage("signature");
      if (result && mounted.current)
        onChange({ signature_image_url: result.url });
    } catch (e: any) {
      if (mounted.current) setError(e.message);
    } finally {
      if (mounted.current) {
        setBusy(false);
        onBusyChange?.(false);
      }
    }
  }
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderColor: t.border,
        paddingTop: 20,
        marginBottom: 24,
      }}
    >
      <Text style={{ color: t.text, fontSize: 17, fontWeight: "600" }}>
        Sender & email signatory
      </Text>
      <Field
        t={t}
        label="Sender name"
        value={value.sender_name || ""}
        maxLength={120}
        onChangeText={(sender_name: string) => onChange({ sender_name })}
        placeholder="Your name as it should appear in emails"
      />
      <Field
        t={t}
        label="Email signatory text (optional)"
        value={value.signature_text || ""}
        multiline
        maxLength={2000}
        onChangeText={(signature_text: string) => onChange({ signature_text })}
        placeholder="Job title, business name, contact details"
        style={{ minHeight: 100, textAlignVertical: "top" }}
      />
      <Text style={{ color: t.text, fontSize: 13, marginTop: 18 }}>
        Email signatory image (optional)
      </Text>
      <Action
        t={t}
        label={
          busy
            ? "Uploading image…"
            : value.signature_image_url
              ? "Replace signatory image"
              : "Upload signatory image"
        }
        disabled={busy || demo}
        onPress={() => void upload()}
      />
      {value.signature_image_url && (
        <Action
          t={t}
          label="Remove signatory image"
          disabled={busy}
          onPress={() => onChange({ signature_image_url: "" })}
        />
      )}
      <Text
        style={{ color: t.muted, fontSize: 12, lineHeight: 21, marginTop: 12 }}
      >
        Every message ends with your sender name, followed by this optional text
        and image. Uploaded signatory images are visible to anyone with their
        link. {demo ? "Sign in to upload images." : ""}
      </Text>
      {error && (
        <Text
          accessibilityRole="alert"
          style={{ color: t.danger, marginTop: 10 }}
        >
          {error}
        </Text>
      )}
      <SignaturePreview value={value} t={t} />
    </View>
  );
}
export function ProfileSettings({ user, t }: { user: User; t: Palette }) {
  const [first, setFirst] = useState(user.user_metadata.first_name || ""),
    [last, setLast] = useState(user.user_metadata.last_name || ""),
    [photo, setPhoto] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [confirm, setConfirm] = useState(false),
    [word, setWord] = useState(""),
    [password, setPassword] = useState(""),
    [visible, setVisible] = useState(false);
  useEffect(() => {
    setFirst(user.user_metadata.first_name || "");
    setLast(user.user_metadata.last_name || "");
    let valid = true;
    void avatarUrl(user.user_metadata.avatar_path, user.id).then((url) => {
      if (valid) setPhoto(url);
    });
    return () => {
      valid = false;
    };
  }, [
    user.id,
    user.user_metadata.first_name,
    user.user_metadata.last_name,
    user.user_metadata.avatar_path,
  ]);
  async function perform(label: string, work: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e: any) {
      setError(e.message || "Please try again.");
    } finally {
      setBusy("");
    }
  }
  async function save() {
    if (first.trim().length > 80 || last.trim().length > 80)
      throw new Error("Keep each name under 80 characters.");
    const result = await supabase.auth.updateUser({
      data: {
        first_name: first.trim(),
        last_name: last.trim(),
        full_name: [first.trim(), last.trim()].filter(Boolean).join(" "),
      },
    });
    if (result.error)
      throw new Error("Your profile could not be saved. Please try again.");
    setNotice("Profile updated.");
  }
  async function photoChange(remove = false) {
    const image = remove ? null : await uploadProfileImage("avatar");
    if (!remove && !image) return;
    const previous = user.user_metadata.avatar_path;
    const { error } = await supabase.auth.updateUser({
      data: { avatar_path: image?.path || null },
    });
    if (error) {
      if (image) await supabase.storage.from("avatars").remove([image.path]);
      throw new Error("Your profile picture could not be saved.");
    }
    setPhoto(image?.url || "");
    if (typeof previous === "string" && previous.startsWith(`${user.id}/`))
      await supabase.storage.from("avatars").remove([previous]);
    setNotice(remove ? "Profile picture removed." : "Profile picture updated.");
  }
  function close() {
    if (busy === "Deleting account") return;
    setConfirm(false);
    setWord("");
    setPassword("");
    setVisible(false);
    setError("");
  }
  async function removeAccount() {
    await api("delete-account", { confirmation: word, password });
    setConfirm(false);
    setPassword("");
    await supabase.auth.signOut({ scope: "local" });
  }
  const muted = { color: t.muted, fontSize: 12, lineHeight: 21 } as const;
  return (
    <View style={{ gap: 12, marginBottom: 24 }}>
      <Text style={{ color: t.text, fontSize: 20, fontWeight: "600" }}>
        Your profile
      </Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 18,
          flexWrap: "wrap",
        }}
      >
        {photo ? (
          <Image
            source={{ uri: photo }}
            accessibilityLabel="Profile picture"
            style={{ width: 88, height: 88, borderRadius: 44 }}
          />
        ) : (
          <View
            style={{
              width: 88,
              height: 88,
              borderRadius: 44,
              backgroundColor: t.raised,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <UserRound color={t.muted} size={36} />
          </View>
        )}
        <View>
          <Action
            t={t}
            label="Change profile picture"
            disabled={!!busy}
            onPress={() =>
              void perform("Uploading picture", () => photoChange())
            }
          />
          {!!photo && (
            <Pressable
              accessibilityRole="button"
              disabled={!!busy}
              onPress={() =>
                void perform("Removing picture", () => photoChange(true))
              }
            >
              <Text style={{ color: t.muted, marginTop: 12 }}>
                Remove profile picture
              </Text>
            </Pressable>
          )}
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
        <View style={{ flex: 1, minWidth: 180 }}>
          <Field
            t={t}
            label="First name"
            value={first}
            maxLength={80}
            onChangeText={setFirst}
            autoComplete="given-name"
          />
        </View>
        <View style={{ flex: 1, minWidth: 180 }}>
          <Field
            t={t}
            label="Last name"
            value={last}
            maxLength={80}
            onChangeText={setLast}
            autoComplete="family-name"
          />
        </View>
      </View>
      <Action
        t={t}
        label="Save profile"
        disabled={!!busy}
        onPress={() => void perform("Saving profile", save)}
      />
      <View
        style={{
          borderTopWidth: 1,
          borderColor: t.border,
          marginTop: 20,
          paddingTop: 20,
        }}
      >
        <Text style={{ color: t.text, fontSize: 17, fontWeight: "600" }}>
          Password
        </Text>
        <Text style={[muted, { marginTop: 8 }]}>
          Send a secure reset link to {user.email}.
        </Text>
        <Action
          t={t}
          label="Reset password"
          disabled={!!busy}
          onPress={() =>
            void perform("Requesting reset", async () =>
              setNotice(
                await requestPasswordReset(supabase.auth, user.email || ""),
              ),
            )
          }
        />
      </View>
      <View
        style={{
          borderTopWidth: 1,
          borderColor: t.border,
          marginTop: 20,
          paddingTop: 20,
        }}
      >
        <Text style={{ color: t.text, fontSize: 17, fontWeight: "600" }}>
          Account
        </Text>
        <Text style={[muted, { marginTop: 8 }]}>
          Permanently delete your account and private workspace data.
        </Text>
        <Action
          t={t}
          label="Delete account"
          danger
          disabled={!!busy}
          onPress={() => {
            setError("");
            setConfirm(true);
          }}
        />
      </View>
      {!!busy && (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <ActivityIndicator color={t.accent} />
          <Text style={muted}>{busy}…</Text>
        </View>
      )}
      {!!notice && (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: t.accent, lineHeight: 22 }}
        >
          {notice}
        </Text>
      )}
      {!!error && !confirm && (
        <Text
          accessibilityRole="alert"
          style={{ color: t.danger, lineHeight: 22 }}
        >
          {error}
        </Text>
      )}
      <Modal
        visible={confirm}
        transparent
        animationType="fade"
        onRequestClose={close}
      >
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            backgroundColor: "rgba(0,0,0,.7)",
            padding: 20,
          }}
        >
          <ScrollView
            style={{
              maxHeight: "90%",
              flexGrow: 0,
              width: "100%",
              maxWidth: 510,
              alignSelf: "center",
              backgroundColor: t.panel,
              borderRadius: 14,
            }}
            contentContainerStyle={{ padding: 24, gap: 12 }}
          >
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Trash2 color={t.danger} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel account deletion"
                disabled={!!busy}
                onPress={close}
              >
                <X color={t.text} />
              </Pressable>
            </View>
            <Text style={{ color: t.text, fontSize: 22, fontWeight: "600" }}>
              Delete your account forever?
            </Text>
            <Text style={muted}>
              This cannot be undone. Your profile, uploaded pictures, audience
              profiles, lists, private leads, campaigns and email connections
              will be permanently removed. Campaigns will stop; emails already
              submitted cannot be recalled. Public prospect-pool records remain
              available to other users.
            </Text>
            <Field
              t={t}
              label="Type DELETE to confirm"
              value={word}
              onChangeText={setWord}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!busy}
            />
            <View>
              <Field
                t={t}
                label="Current password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!visible}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="current-password"
                editable={!busy}
                style={{ paddingRight: 52 }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  visible ? "Hide current password" : "Show current password"
                }
                onPress={() => setVisible(!visible)}
                style={{ position: "absolute", right: 14, bottom: 14 }}
              >
                {visible ? (
                  <EyeOff size={20} color={t.muted} />
                ) : (
                  <Eye size={20} color={t.muted} />
                )}
              </Pressable>
            </View>
            {!!error && (
              <Text
                accessibilityRole="alert"
                style={{ color: t.danger, lineHeight: 22 }}
              >
                {error}
              </Text>
            )}
            <Action
              t={t}
              label={
                busy === "Deleting account"
                  ? "Deleting account…"
                  : "Permanently delete my account"
              }
              danger
              disabled={!!busy || word !== "DELETE" || !password}
              onPress={() => void perform("Deleting account", removeAccount)}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Keep my account"
              disabled={!!busy}
              onPress={close}
              style={{ paddingVertical: 16 }}
            >
              <Text style={{ color: t.text, textAlign: "center" }}>
                Keep my account
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
