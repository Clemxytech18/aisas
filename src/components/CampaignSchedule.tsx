import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  ScrollView,
} from "react-native";
import {
  CalendarDays,
  Clock,
  ChevronLeft,
  ChevronRight,
  X,
  Check,
} from "lucide-react-native";
import {
  localDateKey,
  scheduleDraft,
  scheduleToISO,
  monthDays,
  formatCampaignStart,
  scheduleTimezone,
  type ScheduleDraft,
} from "../campaign-schedule";
type Palette = {
  bg: string;
  panel: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  danger: string;
  soft: string;
};
type Props = { value: string; onChange: (iso: string) => void; t: Palette };
export function CampaignSchedule({ value, onChange, t }: Props) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState<ScheduleDraft>(() => scheduleDraft(value)),
    [month, setMonth] = useState(() => new Date()),
    [error, setError] = useState("");
  function show() {
    const next = scheduleDraft(value);
    setDraft(next);
    const [y, m] = next.date.split("-").map(Number);
    setMonth(new Date(y, m - 1, 1));
    setError("");
    setOpen(true);
  }
  function apply() {
    try {
      onChange(scheduleToISO(draft));
      setOpen(false);
    } catch (e: any) {
      setError(e.message);
    }
  }
  const preview = (() => {
    try {
      return scheduleToISO(draft, new Date(0));
    } catch {
      return "";
    }
  })();
  const today = localDateKey(new Date()),
    year = month.getFullYear(),
    monthIndex = month.getMonth();
  const previousDisabled =
    year <= new Date().getFullYear() && monthIndex <= new Date().getMonth();
  const copy = { fontSize: 12, color: t.muted, lineHeight: 21 } as const;
  const choice = (scheduled: boolean, label: string, description: string) => (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: scheduled ? !!value : !value }}
      onPress={scheduled ? show : () => onChange("")}
      style={{
        padding: 15,
        borderWidth: 1,
        borderColor: (scheduled ? !!value : !value) ? t.accent : t.border,
        borderRadius: 9,
        gap: 5,
        backgroundColor: (scheduled ? !!value : !value) ? t.soft : t.bg,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {scheduled ? (
          <CalendarDays size={17} color={t.text} />
        ) : (
          <Clock size={17} color={t.text} />
        )}
        <Text
          style={{ color: t.text, fontSize: 13, fontWeight: "600", flex: 1 }}
        >
          {label}
        </Text>
        {(scheduled ? !!value : !value) && <Check size={16} color={t.accent} />}
      </View>
      <Text style={copy}>{description}</Text>
    </Pressable>
  );
  return (
    <View style={{ gap: 10, marginTop: 20, marginBottom: 24 }}>
      <Text style={{ fontSize: 12, color: t.text, fontWeight: "600" }}>
        When should this campaign start?
      </Text>
      {choice(
        false,
        "Start when launched",
        "Send after you approve and launch this campaign.",
      )}
      {choice(
        true,
        "Schedule for later",
        value
          ? formatCampaignStart(value)
          : "Choose a date and time from the calendar.",
      )}
      <Text style={[copy, { fontSize: 11 }]}>
        Time zone: {scheduleTimezone(value ? new Date(value) : undefined)}.
        Times follow your device’s time zone.
      </Text>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "#0009",
            padding: 20,
            justifyContent: "center",
          }}
        >
          <View
            accessibilityViewIsModal
            style={{
              width: "100%",
              maxWidth: 430,
              maxHeight: "94%",
              alignSelf: "center",
              padding: 20,
              borderRadius: 14,
              backgroundColor: t.panel,
              gap: 15,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <Text
                style={{
                  fontSize: 20,
                  color: t.text,
                  fontWeight: "500",
                  flex: 1,
                }}
              >
                Choose your start time
              </Text>
              <Pressable
                accessibilityLabel="Close calendar"
                onPress={() => setOpen(false)}
                style={{ padding: 10 }}
              >
                <X size={20} color={t.muted} />
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={{ gap: 17 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Previous month"
                    disabled={previousDisabled}
                    onPress={() => setMonth(new Date(year, monthIndex - 1, 1))}
                    style={{ padding: 12, opacity: previousDisabled ? 0.3 : 1 }}
                  >
                    <ChevronLeft size={20} color={t.text} />
                  </Pressable>
                  <Text
                    style={{ fontWeight: "600", fontSize: 15, color: t.text }}
                  >
                    {month.toLocaleDateString(undefined, {
                      month: "long",
                      year: "numeric",
                    })}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Next month"
                    disabled={year >= 2100 && monthIndex === 11}
                    onPress={() => setMonth(new Date(year, monthIndex + 1, 1))}
                    style={{ padding: 12 }}
                  >
                    <ChevronRight size={20} color={t.text} />
                  </Pressable>
                </View>
                <View style={{ flexDirection: "row" }}>
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                    (day) => (
                      <Text
                        key={day}
                        style={{
                          width: "14.285714%",
                          fontSize: 10,
                          color: t.muted,
                          textAlign: "center",
                          paddingBottom: 8,
                        }}
                      >
                        {day}
                      </Text>
                    ),
                  )}
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    marginTop: -10,
                  }}
                >
                  {monthDays(year, monthIndex).map((day, i) => {
                    const date = day ? new Date(year, monthIndex, day) : null,
                      key = date ? localDateKey(date) : "",
                      disabled = !date || key < today,
                      selected = draft.date === key;
                    return (
                      <View key={i} style={{ width: "14.285714%", padding: 2 }}>
                        {day ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={date!.toLocaleDateString(
                              undefined,
                              {
                                weekday: "long",
                                day: "numeric",
                                month: "long",
                                year: "numeric",
                              },
                            )}
                            accessibilityState={{ selected, disabled }}
                            disabled={disabled}
                            onPress={() => {
                              setDraft((v) => ({ ...v, date: key }));
                              setError("");
                            }}
                            style={{
                              height: 38,
                              justifyContent: "center",
                              alignItems: "center",
                              borderRadius: 7,
                              backgroundColor: selected
                                ? t.accent
                                : "transparent",
                              borderWidth: 1,
                              borderColor:
                                key === today && !selected
                                  ? t.border
                                  : "transparent",
                              opacity: disabled ? 0.3 : 1,
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 13,
                                color: selected ? t.accentText : t.text,
                              }}
                            >
                              {day}
                            </Text>
                          </Pressable>
                        ) : (
                          <View style={{ height: 38 }} />
                        )}
                      </View>
                    );
                  })}
                </View>
                <View style={{ gap: 8 }}>
                  <Text
                    style={{ color: t.text, fontSize: 12, fontWeight: "600" }}
                  >
                    Time
                  </Text>
                  <View
                    style={{
                      flexDirection: "row",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    {(["hour", "minute"] as const).map((field, i) => (
                      <React.Fragment key={field}>
                        {i === 1 && (
                          <Text style={{ color: t.text, fontSize: 20 }}>:</Text>
                        )}
                        <View style={{ flex: 1, gap: 5 }}>
                          <Text style={{ fontSize: 10, color: t.muted }}>
                            {field === "hour" ? "Hour" : "Minutes"}
                          </Text>
                          <TextInput
                            accessibilityLabel={
                              field === "hour"
                                ? "Start hour, 1 to 12"
                                : "Start minutes, 00 to 59"
                            }
                            value={draft[field]}
                            onChangeText={(v) => {
                              setDraft((x) => ({
                                ...x,
                                [field]: v.replace(/\D/g, "").slice(0, 2),
                              }));
                              setError("");
                            }}
                            keyboardType="number-pad"
                            selectTextOnFocus
                            maxLength={2}
                            placeholder={field === "hour" ? "10" : "00"}
                            placeholderTextColor={t.muted}
                            style={{
                              minHeight: 46,
                              color: t.text,
                              padding: 12,
                              borderRadius: 7,
                              borderWidth: 1,
                              borderColor: t.border,
                              backgroundColor: t.bg,
                              fontSize: 16,
                            }}
                          />
                        </View>
                      </React.Fragment>
                    ))}
                    <View
                      style={{
                        flexDirection: "row",
                        alignSelf: "flex-end",
                        borderWidth: 1,
                        borderColor: t.border,
                        borderRadius: 7,
                        overflow: "hidden",
                      }}
                    >
                      {(["AM", "PM"] as const).map((period) => (
                        <Pressable
                          key={period}
                          accessibilityRole="radio"
                          accessibilityState={{
                            checked: draft.period === period,
                          }}
                          onPress={() => {
                            setDraft((v) => ({ ...v, period }));
                            setError("");
                          }}
                          style={{
                            paddingVertical: 14,
                            paddingHorizontal: 11,
                            backgroundColor:
                              draft.period === period ? t.accent : t.bg,
                          }}
                        >
                          <Text
                            style={{
                              color:
                                draft.period === period
                                  ? t.accentText
                                  : t.muted,
                              fontSize: 12,
                              fontWeight: "600",
                            }}
                          >
                            {period}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                </View>
                <Text style={[copy, { fontSize: 11 }]}>
                  Time zone:{" "}
                  {scheduleTimezone(preview ? new Date(preview) : undefined)}
                </Text>
                {!!preview && (
                  <View
                    style={{
                      padding: 13,
                      borderRadius: 8,
                      backgroundColor: t.soft,
                    }}
                  >
                    <Text
                      style={{ fontSize: 12, color: t.text, lineHeight: 22 }}
                    >
                      Scheduled for {formatCampaignStart(preview)}
                    </Text>
                  </View>
                )}
                {!!error && (
                  <Text
                    accessibilityRole="alert"
                    style={{ fontSize: 12, lineHeight: 21, color: t.danger }}
                  >
                    {error}
                  </Text>
                )}
              </View>
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              onPress={apply}
              style={{
                padding: 15,
                backgroundColor: t.accent,
                borderRadius: 8,
                alignItems: "center",
              }}
            >
              <Text
                style={{ color: t.accentText, fontSize: 13, fontWeight: "700" }}
              >
                Use this date & time
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
