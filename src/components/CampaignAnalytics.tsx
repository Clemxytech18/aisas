import React from "react";
import { View, Text } from "react-native";
import {
  campaignMetrics,
  type CampaignAnalytics as Analytics,
} from "../campaign-analytics";
import { dailySendingStatus } from "../campaign-daily";
import { formatCampaignStart } from "../campaign-schedule";
type Theme = {
  text: string;
  muted: string;
  accent: string;
  raised: string;
  border: string;
  danger: string;
};
export function CampaignAnalytics({ data, t }: { data?: Analytics; t: Theme }) {
  if (!data)
    return (
      <Text style={{ color: t.muted, fontSize: 12, marginVertical: 16 }}>
        Campaign analytics are loading…
      </Text>
    );
  return (
    <View style={{ gap: 14, marginBottom: 18 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {campaignMetrics(data).map((metric) => (
          <View
            key={metric.label}
            style={{
              backgroundColor: t.raised,
              borderColor: t.border,
              borderWidth: 1,
              borderRadius: 10,
              padding: 14,
              minWidth: 125,
              flexGrow: 1,
              flexBasis: "20%",
            }}
          >
            <Text style={{ color: t.muted, fontSize: 10, lineHeight: 17 }}>
              {metric.label}
            </Text>
            <Text
              style={{
                color: t.text,
                fontSize: 24,
                fontWeight: "600",
                marginTop: 6,
              }}
            >
              {metric.value === null ? "—" : metric.value.toLocaleString()}
            </Text>
          </View>
        ))}
      </View>
      {data.daily_send_limit != null && (
        <View
          style={{
            borderWidth: 1,
            borderColor: t.border,
            borderRadius: 10,
            padding: 14,
            gap: 8,
          }}
        >
          <Text style={{ color: t.text, fontSize: 14, fontWeight: "600" }}>
            Today · {data.daily_sent || 0} / {data.daily_send_limit} successful
            emails
          </Text>
          <Text style={{ color: t.muted, fontSize: 12, lineHeight: 21 }}>
            {data.daily_remaining || 0} daily slots available ·{" "}
            {data.daily_reserved || 0} awaiting confirmation · resets at
            midnight ({data.send_timezone || "UTC"})
          </Text>
          {!!dailySendingStatus(data) && (
            <Text style={{ color: t.accent, fontSize: 12, lineHeight: 21 }}>
              {dailySendingStatus(data)}
            </Text>
          )}
        </View>
      )}
      <Text style={{ color: t.muted, fontSize: 11, lineHeight: 19 }}>
        {data.pending} pending · {data.processing} processing ·{" "}
        {data.suppressed} suppressed · {data.uncertain} awaiting confirmation
        {data.next_send_at && !dailySendingStatus(data)
          ? ` · Next due: ${formatCampaignStart(data.next_send_at)}`
          : ""}
      </Text>
      {data.uncertain > 0 && (
        <Text style={{ color: t.danger, fontSize: 11, lineHeight: 19 }}>
          Some sends have an unconfirmed outcome. Automatic resend is blocked to
          prevent duplicates; check your sending mailbox.
        </Text>
      )}
      {data.last_error_code && (
        <Text style={{ color: t.danger, fontSize: 11 }}>
          Delivery worker needs attention. Queued messages remain saved.
        </Text>
      )}
      {!data.last_run_at && data.pending > 0 && (
        <Text style={{ color: t.danger, fontSize: 11 }}>
          Waiting for the delivery worker to process this campaign.
        </Text>
      )}
      {data.errors?.map((e, index) => (
        <Text
          key={`${index}:${e.status}`}
          style={{
            color: e.status === "suppressed" ? t.muted : t.danger,
            fontSize: 11,
            lineHeight: 19,
          }}
        >
          {e.status}: {e.last_error}
        </Text>
      ))}
      <Text style={{ color: t.muted, fontSize: 10, lineHeight: 17 }}>
        Valid recipients have an email address; this does not imply inbox
        verification. Sent means accepted by the sending provider and includes
        follow-ups. Reads, bounces and responses count unique recipients.{" "}
        {data.tracking_ready
          ? "Reads are tracking-image loads; privacy settings and image proxies can affect counts."
          : "Read and response tracking are not configured yet."}
      </Text>
    </View>
  );
}
