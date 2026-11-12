import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  ScrollView,
  Linking,
  ActivityIndicator,
} from "react-native";
import { Sparkles, Target, Plus, X, ShieldCheck } from "lucide-react-native";
import {
  IDEAL_FIELDS,
  emptyIdealCriteria,
  prepareIdealCriteria,
  type IdealProfile,
  type IdealCriteria,
} from "../ideal-profile";
import { supabase, api } from "../supabase";
import { persistRow } from "../store";
import { prepareProfile } from "../profile-proof";
import { uid, type ScoutingProfile, type Lead } from "../domain";
type Theme = {
  bg: string;
  panel: string;
  raised: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  danger: string;
  blue: string;
};
function Action({
  label,
  t,
  onPress,
  disabled = false,
  secondary = false,
}: {
  label: string;
  t: Theme;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{
        paddingVertical: 13,
        paddingHorizontal: 17,
        borderRadius: 9,
        backgroundColor: secondary ? t.raised : t.accent,
        borderWidth: 1,
        borderColor: secondary ? t.border : t.accent,
        opacity: disabled ? 0.5 : 1,
        alignSelf: "flex-start",
        maxWidth: "100%",
      }}
    >
      <Text
        style={{
          color: secondary ? t.text : t.accentText,
          fontWeight: "600",
          fontSize: 13,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
function Field({ label, t, ...props }: any) {
  return (
    <View style={{ gap: 8, marginBottom: 18 }}>
      <Text style={{ color: t.text, fontSize: 13, fontWeight: "500" }}>
        {label}
      </Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={t.muted}
        style={{
          color: t.text,
          backgroundColor: t.bg,
          borderWidth: 1,
          borderColor: t.border,
          borderRadius: 9,
          padding: 13,
          minHeight: props.multiline ? 100 : 46,
          textAlignVertical: "top",
          fontSize: 13,
          lineHeight: 21,
        }}
      />
    </View>
  );
}
const emptyAudience = (): ScoutingProfile => ({
  id: uid(),
  name: "",
  audience: "",
  location: "",
  niche: "",
  sub_niche: "",
  usp: "",
  offer: "",
});
export function IdealProspectsPanel({
  profiles,
  demo,
  t,
  onLaunch,
  onWorkspaceChanged,
  onSignIn,
}: {
  profiles: ScoutingProfile[];
  demo: boolean;
  t: Theme;
  onLaunch: (profile: IdealProfile, audience: ScoutingProfile) => void;
  onWorkspaceChanged: () => Promise<void>;
  onSignIn: () => void;
}) {
  const [saved, setSaved] = useState<IdealProfile[]>([]),
    [draft, setDraft] = useState<IdealProfile | null>(null),
    [source, setSource] = useState<"existing" | "manual">("existing"),
    [audience, setAudience] = useState<ScoutingProfile>(emptyAudience),
    [stage, setStage] = useState<"manual" | "ai" | "review">("manual"),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  async function refresh() {
    if (demo) return;
    const result = await supabase
      .from("ideal_profiles")
      .select("*")
      .order("created_at", { ascending: false });
    if (result.error)
      throw new Error("Ideal profiles could not be loaded. Please retry.");
    setSaved(result.data || []);
  }
  useEffect(() => {
    let current = true;
    if (!demo)
      supabase
        .from("ideal_profiles")
        .select("*")
        .order("created_at", { ascending: false })
        .then((r) => {
          if (current) {
            if (r.error)
              setError("Ideal profiles could not be loaded. Please refresh.");
            else setSaved(r.data || []);
          }
        });
    else setSaved([]);
    return () => {
      current = false;
    };
  }, [demo]);
  function start(ai = false) {
    setDraft({
      id: uid(),
      name: "",
      audience_profile_id: profiles[0]?.id || "",
      ...emptyIdealCriteria(),
    });
    setSource(profiles.length ? "existing" : "manual");
    setAudience(emptyAudience());
    setStage(ai ? "ai" : "manual");
    setError("");
  }
  async function perform(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message || "Please try again.");
    } finally {
      setBusy("");
    }
  }
  function selectedAudience() {
    if (source === "manual") return prepareProfile(audience);
    const selected = profiles.find((p) => p.id === draft?.audience_profile_id);
    if (!selected)
      throw new Error(
        "Choose an existing audience profile or enter a new one.",
      );
    return selected;
  }
  async function generate() {
    if (demo) {
      onSignIn();
      return;
    }
    const selected = selectedAudience();
    const result = await api(
      "ideal-generate",
      source === "existing"
        ? { profile_id: selected.id }
        : { audience_profile: selected },
    );
    const criteria = prepareIdealCriteria(result.criteria);
    setDraft((current) =>
      current
        ? {
            ...current,
            ...criteria,
            name: current.name || `${selected.name} · Ideal`.slice(0, 160),
          }
        : null,
    );
    setStage("review");
  }
  async function save(launch: boolean) {
    if (!draft) return;
    const criteria = prepareIdealCriteria(draft);
    if (!draft.name.trim() || draft.name.trim().length > 160)
      throw new Error(
        "Give this ideal profile a name of up to 160 characters.",
      );
    const selected = selectedAudience();
    if (demo) {
      onSignIn();
      return;
    }
    if (source === "manual") await persistRow("scouting_profiles", selected);
    const row = {
      id: draft.id,
      name: draft.name.trim(),
      audience_profile_id: selected.id,
      ...criteria,
    };
    await persistRow("ideal_profiles", row);
    await onWorkspaceChanged();
    await refresh();
    setDraft(null);
    if (launch) onLaunch(row, selected);
  }
  const muted = { color: t.muted, fontSize: 12, lineHeight: 22 } as const;
  return (
    <View style={{ gap: 22 }}>
      <View
        style={{
          backgroundColor: t.panel,
          padding: 24,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: t.border,
          gap: 15,
        }}
      >
        <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
          <Target size={24} color={t.accent} />
          <Text
            style={{ color: t.text, fontSize: 22, fontWeight: "600", flex: 1 }}
          >
            Find prospects worth pursuing.
          </Text>
        </View>
        <Text style={muted}>
          Define who fits, what matters, and which public signals would justify
          a conversation. Ideal Prospects discovers leads, verifies fit against
          your criteria, and saves qualified contacts with source evidence.
        </Text>
        <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
          <Action
            t={t}
            label="Fill ideal profile manually"
            disabled={!!busy}
            onPress={() => start(false)}
          />
          <Action
            t={t}
            label="Define ideal profile with AI"
            secondary
            disabled={!!busy}
            onPress={() => start(true)}
          />
        </View>
        <Text style={muted}>
          Qualification requires evidence for business fit, the decision-maker
          and starting segment, plus a relevant need or signal and at least
          70/100 evidence fit. Unknown facts are not assumed. Published contact
          details are required.
        </Text>
      </View>
      {!!draft && (
        <View
          style={{
            backgroundColor: t.panel,
            padding: 24,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: t.border,
            gap: 10,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Text
              style={{
                color: t.text,
                fontSize: 20,
                fontWeight: "600",
                flex: 1,
              }}
            >
              {stage === "ai"
                ? "Start with your audience profile"
                : stage === "review"
                  ? "Review the AI definition"
                  : "Define your ideal prospect"}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close ideal profile editor"
              disabled={!!busy}
              onPress={() => setDraft(null)}
            >
              <X size={22} color={t.muted} />
            </Pressable>
          </View>
          <Text style={muted}>
            Choose the audience and service context that AI should use. Your
            seven criteria remain editable before you save or search.
          </Text>
          <View
            style={{
              flexDirection: "row",
              gap: 10,
              flexWrap: "wrap",
              marginVertical: 10,
            }}
          >
            {(["existing", "manual"] as const).map((value) => (
              <Action
                key={value}
                t={t}
                label={
                  value === "existing"
                    ? "Use existing audience profile"
                    : "Enter a new audience profile"
                }
                secondary={source !== value}
                disabled={!!busy}
                onPress={() => setSource(value)}
              />
            ))}
          </View>
          {source === "existing" ? (
            <View style={{ gap: 10, marginBottom: 18 }}>
              {profiles.length ? (
                profiles.map((p) => (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityLabel={`Audience: ${p.name}`}
                    aria-checked={draft.audience_profile_id === p.id}
                    accessibilityState={{
                      checked: draft.audience_profile_id === p.id,
                    }}
                    disabled={!!busy}
                    key={p.id}
                    onPress={() =>
                      setDraft({ ...draft, audience_profile_id: p.id })
                    }
                    style={{
                      padding: 14,
                      borderWidth: 1,
                      borderColor:
                        draft.audience_profile_id === p.id
                          ? t.accent
                          : t.border,
                      borderRadius: 9,
                    }}
                  >
                    <Text style={{ color: t.text }}>{p.name}</Text>
                    <Text style={[muted, { marginTop: 5 }]}>
                      {p.audience} · {p.location}
                    </Text>
                  </Pressable>
                ))
              ) : (
                <Text style={muted}>
                  No audience profiles yet. Enter a new audience profile to
                  continue.
                </Text>
              )}
            </View>
          ) : (
            <View
              style={{
                borderWidth: 1,
                borderColor: t.border,
                padding: 16,
                borderRadius: 10,
                marginBottom: 12,
              }}
            >
              {(
                [
                  [
                    "name",
                    "Audience profile name",
                    "e.g. Residential HVAC growth",
                  ],
                  [
                    "audience",
                    "Target business category",
                    "Residential HVAC contractors",
                  ],
                  ["location", "Target location", "e.g. Austin, Texas, USA"],
                  ["niche", "Your service niche", "AI automation"],
                  [
                    "sub_niche",
                    "Your sub-niche",
                    "Call handling and appointment scheduling",
                  ],
                  [
                    "usp",
                    "Your unique service proposition",
                    "What makes your approach different?",
                  ],
                  [
                    "offer",
                    "Your value / offer",
                    "What can you offer this audience?",
                  ],
                ] as const
              ).map(([key, label, placeholder]) => (
                <Field
                  key={key}
                  t={t}
                  label={label}
                  placeholder={placeholder}
                  value={audience[key]}
                  multiline={["usp", "offer"].includes(key)}
                  onChangeText={(value: string) =>
                    setAudience({ ...audience, [key]: value })
                  }
                />
              ))}
            </View>
          )}
          <Action
            t={t}
            label={
              stage === "review"
                ? "Regenerate ideal criteria with AI"
                : "Generate ideal criteria with AI"
            }
            secondary
            disabled={!!busy}
            onPress={() => void perform("Defining ideal criteria", generate)}
          />
          {stage !== "ai" && (
            <View style={{ marginTop: 16 }}>
              <Field
                t={t}
                label="Ideal profile name"
                placeholder="e.g. Independent HVAC service teams"
                value={draft.name}
                maxLength={160}
                onChangeText={(name: string) => setDraft({ ...draft, name })}
              />
              {IDEAL_FIELDS.map(([key, label, placeholder]) => (
                <Field
                  key={key}
                  t={t}
                  label={label}
                  placeholder={placeholder}
                  value={draft[key]}
                  multiline
                  maxLength={2000}
                  onChangeText={(value: string) =>
                    setDraft({ ...draft, [key]: value })
                  }
                />
              ))}
              <Text style={[muted, { marginBottom: 18 }]}>
                These are targeting criteria, not claims about any company. AI
                will qualify actual prospects using public evidence. After
                saving, choose Boolean Scouting or Google Maps Scouting.
              </Text>
              <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
                <Action
                  t={t}
                  label="Save & find ideal prospects"
                  disabled={!!busy}
                  onPress={() =>
                    void perform("Saving ideal profile", () => save(true))
                  }
                />
                <Action
                  t={t}
                  label="Save ideal profile"
                  secondary
                  disabled={!!busy}
                  onPress={() =>
                    void perform("Saving ideal profile", () => save(false))
                  }
                />
              </View>
            </View>
          )}
          {!!busy && (
            <View
              style={{
                flexDirection: "row",
                gap: 9,
                alignItems: "center",
                marginTop: 15,
              }}
            >
              <ActivityIndicator color={t.accent} />
              <Text style={muted}>{busy}…</Text>
            </View>
          )}
        </View>
      )}
      {!!error && (
        <Text
          accessibilityRole="alert"
          style={{ color: t.danger, lineHeight: 22 }}
        >
          {error}
        </Text>
      )}
      {!!saved.length && (
        <Text style={{ color: t.text, fontSize: 19, fontWeight: "600" }}>
          Your ideal profiles
        </Text>
      )}
      {saved.map((p) => (
        <View
          key={p.id}
          style={{
            backgroundColor: t.panel,
            borderWidth: 1,
            borderColor: t.border,
            borderRadius: 14,
            padding: 22,
            gap: 14,
          }}
        >
          <Text style={{ color: t.text, fontSize: 17, fontWeight: "600" }}>
            {p.name}
          </Text>
          <Text style={muted}>{p.business}</Text>
          <Text style={muted}>Decision-maker · {p.decision_maker}</Text>
          <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
            <Action
              t={t}
              label={`Find ideal prospects · ${p.name}`}
              disabled={!!busy}
              onPress={() => {
                const selected = profiles.find(
                  (a) => a.id === p.audience_profile_id,
                );
                if (selected) onLaunch(p, selected);
                else
                  setError(
                    "The linked audience profile is unavailable. Refresh and retry.",
                  );
              }}
            />
            <Action
              t={t}
              label={`Edit criteria · ${p.name}`}
              secondary
              disabled={!!busy}
              onPress={() => {
                setDraft(p);
                setSource("existing");
                setStage("manual");
                setError("");
              }}
            />
          </View>
        </View>
      ))}
      {demo && (
        <Text style={muted}>
          Sign in to save ideal profiles, generate criteria with AI, and run
          evidence-based qualification. Demo leads are not presented as verified
          ideal prospects.
        </Text>
      )}
    </View>
  );
}
export function IdealEvidenceDialog({
  lead,
  t,
  onClose,
}: {
  lead: Lead | null;
  t: Theme;
  onClose: () => void;
}) {
  const report = lead?.ideal_qualification;
  return (
    <Modal
      visible={!!lead}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,.7)",
          padding: 18,
          justifyContent: "center",
        }}
      >
        <View
          style={{
            backgroundColor: t.panel,
            borderRadius: 15,
            width: "100%",
            maxWidth: 760,
            maxHeight: "90%",
            alignSelf: "center",
            padding: 22,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              gap: 15,
              marginBottom: 16,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.accent, fontSize: 12 }}>
                IDEAL PROSPECT · EVIDENCE FIT {report?.score}/100
              </Text>
              <Text
                style={{
                  color: t.text,
                  fontSize: 22,
                  fontWeight: "600",
                  marginTop: 8,
                }}
              >
                {lead?.company || lead?.contact_name}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close qualification evidence"
              onPress={onClose}
            >
              <X size={23} color={t.text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ gap: 18, paddingBottom: 20 }}>
            <Text style={{ color: t.muted, fontSize: 12, lineHeight: 21 }}>
              Qualified against {report?.profile_name || "your ideal profile"}{" "}
              using published sources. Scores reflect evidence against criteria,
              not likelihood of purchase. Business contacts may be shared office
              addresses or numbers.
            </Text>
            {report?.checks.map((c) => (
              <View
                key={c.area}
                style={{
                  borderWidth: 1,
                  borderColor: t.border,
                  borderRadius: 10,
                  padding: 15,
                  gap: 9,
                }}
              >
                <Text
                  style={{
                    color: c.status === "match" ? t.accent : t.muted,
                    fontWeight: "600",
                  }}
                >
                  {IDEAL_FIELDS.find(([area]) => area === c.area)?.[1]} ·{" "}
                  {c.status === "match"
                    ? "Verified match"
                    : c.status === "mismatch"
                      ? "Does not match"
                      : "Unknown"}
                </Text>
                <Text style={{ color: t.muted, fontSize: 12, lineHeight: 21 }}>
                  {report.criteria[c.area]}
                </Text>
                <Text style={{ color: t.text, fontSize: 12, lineHeight: 21 }}>
                  {c.reason}
                </Text>
                {c.evidence.map((e, i) => (
                  <View key={i} style={{ gap: 7 }}>
                    <Text
                      style={{ color: t.text, fontSize: 12, lineHeight: 21 }}
                    >
                      “{e.quote}”
                    </Text>
                    <Pressable
                      accessibilityRole="link"
                      onPress={() => {
                        if (/^https?:\/\//.test(e.url))
                          void Linking.openURL(e.url);
                      }}
                    >
                      <Text
                        style={{ color: t.blue, fontSize: 11, lineHeight: 18 }}
                      >
                        {e.url}
                      </Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
