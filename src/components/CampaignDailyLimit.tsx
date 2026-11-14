import React, { useState } from "react";
import { View, Text, TextInput, Switch, Pressable } from "react-native";
import {
  DEFAULT_DAILY_SEND_LIMIT,
  deviceSendingTimezone,
  minimumSendingDays,
} from "../campaign-daily";
type Palette = {
  text: string;
  muted: string;
  bg: string;
  panel: string;
  border: string;
  accent: string;
};
export function CampaignDailyLimit({
  value,
  zone,
  locked = false,
  recipients,
  onChange,
  t,
}: {
  value?: number | null;
  zone?: string;
  locked?: boolean;
  recipients: number;
  onChange: (patch: {
    daily_send_limit?: number | null;
    send_timezone?: string;
  }) => void;
  t: Palette;
}) {
  const [text, setText] = useState(String(value ?? DEFAULT_DAILY_SEND_LIMIT));
  const enabled = value !== null && value !== undefined;
  const timezone = zone || "UTC",
    localZone = deviceSendingTimezone();
  const days = minimumSendingDays(recipients, enabled ? value! : null);
  const city = timezone.split("/").at(-1)!.replace(/_/g, " ");
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: t.border,
        borderRadius: 10,
        padding: 17,
        gap: 13,
        marginVertical: 20,
      }}
    >
      <Text style={{ color: t.text, fontSize: 16, fontWeight: "600" }}>
        Daily sending limit
      </Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <Text style={{ color: t.text, fontSize: 13, flex: 1 }}>
          Limit successful emails per day
        </Text>
        <Switch
          accessibilityLabel="Limit successful emails per day"
          value={enabled}
          onValueChange={(on) =>
            onChange({ daily_send_limit: on ? Number(text) : null })
          }
        />
      </View>
      {enabled && (
        <View style={{ gap: 8 }}>
          <Text style={{ color: t.text, fontSize: 12 }}>
            Successful emails per day
          </Text>
          <TextInput
            accessibilityLabel="Successful emails per day"
            value={text}
            onChangeText={(v) => {
              setText(v);
              onChange({ daily_send_limit: Number(v) });
            }}
            keyboardType="number-pad"
            placeholder="e.g. 50"
            placeholderTextColor={t.muted}
            style={{
              borderWidth: 1,
              borderColor: t.border,
              borderRadius: 8,
              padding: 13,
              color: t.text,
              backgroundColor: t.bg,
              fontSize: 16,
            }}
          />
        </View>
      )}
      <Text style={{ color: t.muted, fontSize: 12, lineHeight: 21 }}>
        Includes first messages and every follow-up. Counted when your email
        provider accepts the email. Rejected sends do not use a daily slot;
        unconfirmed sends hold capacity until resolved.
      </Text>
      <Text style={{ color: t.muted, fontSize: 12, lineHeight: 21 }}>
        Resets at midnight in{" "}
        {city === timezone ? timezone : `${city} (${timezone})`}.
        {locked ? " The reset timezone is fixed after launch." : ""}
      </Text>
      {!locked && timezone !== localZone && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Use this device’s timezone"
          onPress={() => onChange({ send_timezone: localZone })}
        >
          <Text style={{ color: t.accent, fontSize: 12 }}>
            Use this device’s timezone ({localZone})
          </Text>
        </Pressable>
      )}
      {days !== null && recipients > 0 && (
        <Text style={{ color: t.muted, fontSize: 12, lineHeight: 21 }}>
          If all {recipients.toLocaleString()} unique recipients receive all 4
          messages: at least {days.toLocaleString()} sending{" "}
          {days === 1 ? "day" : "days"}. Follow-up delays or pauses can extend
          the schedule; replies and opt-outs stop remaining follow-ups.
        </Text>
      )}
      {!enabled && (
        <Text style={{ color: t.muted, fontSize: 12, lineHeight: 21 }}>
          No campaign daily cap. Sending-account limits still apply.
        </Text>
      )}
    </View>
  );
}
