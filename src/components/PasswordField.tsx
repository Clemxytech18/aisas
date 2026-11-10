import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  type TextInputProps,
} from "react-native";
import { Eye, EyeOff } from "lucide-react-native";
type Props = Omit<TextInputProps, "secureTextEntry"> & {
  label: string;
  t: { bg: string; border: string; text: string; muted: string };
};
export function PasswordField({ label, t, style, ...props }: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={{ gap: 8, marginBottom: 18 }}>
      <Text style={{ fontSize: 12, color: t.muted }}>{label}</Text>
      <View style={{ position: "relative" }}>
        <TextInput
          {...props}
          accessibilityLabel={label}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          placeholderTextColor={t.muted}
          style={[
            {
              minHeight: 48,
              borderWidth: 1,
              borderColor: t.border,
              borderRadius: 8,
              paddingVertical: 13,
              paddingLeft: 14,
              paddingRight: 56,
              backgroundColor: t.bg,
              color: t.text,
              fontSize: 13,
            },
            style,
          ]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
          accessibilityHint={
            visible
              ? "Mask the password characters"
              : "Reveal the password characters"
          }
          onPress={() => setVisible((v) => !v)}
          style={({ pressed }) => ({
            position: "absolute",
            right: 2,
            top: 2,
            bottom: 2,
            width: 44,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          {visible ? (
            <EyeOff size={19} color={t.muted} />
          ) : (
            <Eye size={19} color={t.muted} />
          )}
        </Pressable>
      </View>
    </View>
  );
}
