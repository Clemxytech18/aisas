import React from "react";
import { View, Text, Pressable, Switch } from "react-native";
import {
  scoutProgress,
  type ScoutOptions,
  type ScoutRun,
} from "../scout-types";
type Theme = {
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  panel: string;
  border: string;
  raised: string;
};
function Choice({
  label,
  values,
  value,
  onChange,
  t,
}: {
  label: string;
  values: number[];
  value: number;
  onChange: (n: number) => void;
  t: Theme;
}) {
  return (
    <View style={{ gap: 10, marginBottom: 18 }}>
      <Text style={{ color: t.text, fontSize: 12 }}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {values.map((n) => (
          <Pressable
            key={n}
            accessibilityRole="button"
            accessibilityState={{ selected: value === n }}
            onPress={() => onChange(n)}
            style={{
              padding: 10,
              borderRadius: 10,
              backgroundColor: value === n ? t.accent : t.raised,
            }}
          >
            <Text style={{ color: value === n ? t.accentText : t.text }}>
              {n.toLocaleString()}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
export function ScoutingCoverageOptions({
  value,
  onChange,
  t,
}: {
  value: ScoutOptions;
  onChange: (v: ScoutOptions) => void;
  t: Theme;
}) {
  return (
    <View>
      <Text style={{ color: t.text, fontSize: 16, marginBottom: 14 }}>
        Search coverage
      </Text>
      <Choice
        label="Target prospects with email or phone"
        values={[25, 50, 100, 250, 500, 1000]}
        value={value.target}
        onChange={(target) => onChange({ ...value, target })}
        t={t}
      />
      <Choice
        label="Maximum search-provider requests"
        values={[10, 30, 60, 100]}
        value={value.searchBudget}
        onChange={(searchBudget) => onChange({ ...value, searchBudget })}
        t={t}
      />
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <Text style={{ color: t.text }}>Read public source pages</Text>
        <Switch
          value={value.readPages}
          onValueChange={(readPages) => onChange({ ...value, readPages })}
        />
      </View>
      {value.readPages && (
        <>
          <Choice
            label="Maximum public source pages"
            values={[100, 200, 500, 1000]}
            value={value.sourceBudget}
            onChange={(sourceBudget) => onChange({ ...value, sourceBudget })}
            t={t}
          />
        </>
      )}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <Text style={{ color: t.text }}>AI-assisted extraction</Text>
        <Switch
          value={value.useAI}
          onValueChange={(useAI) => onChange({ ...value, useAI })}
        />
      </View>
      {value.useAI && (
        <Choice
          label="Maximum AI extraction requests"
          values={[30, 60, 100, 300, 1000]}
          value={value.aiBudget}
          onChange={(aiBudget) => onChange({ ...value, aiBudget })}
          t={t}
        />
      )}
      <Pressable
        accessibilityRole="button"
        onPress={() =>
          onChange({
            target: 1000,
            searchBudget: 100,
            sourceBudget: 1000,
            aiBudget: 1000,
            readPages: true,
            useAI: true,
          })
        }
        style={{
          padding: 12,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: t.border,
          marginBottom: 12,
        }}
      >
        <Text style={{ color: t.accent }}>Use maximum coverage</Text>
      </Pressable>
      <Text
        style={{
          color: t.muted,
          fontSize: 11,
          lineHeight: 19,
          marginBottom: 22,
        }}
      >
        Scouting continues until the target, available sources, or a chosen
        limit is reached. Search requests use SerpAPI credits and AI requests
        use OpenAI credits. Only prospects with a published email or phone are
        saved. Results save as the scout progresses. Keep AISAS open to continue
        automatically, or resume later. Public pages must permit access.
      </Text>
    </View>
  );
}
const reasons: Record<string, string> = {
  target_reached: "Target reached",
  search_budget_reached: "Search-request limit reached",
  source_budget_reached: "Source-page limit reached",
  sources_exhausted: "Available sources exhausted",
  provider_limit: "Search provider limit reached",
  provider_configuration: "Search configuration needs attention",
};
export function ScoutingRuns({
  runs,
  activeId,
  t,
  onResume,
  onPause,
  onOpen,
}: {
  runs: ScoutRun[];
  activeId: string | null;
  t: Theme;
  onResume: (run: ScoutRun) => void;
  onPause: (run: ScoutRun) => void;
  onOpen: (id: string) => void;
}) {
  if (!runs.length) return null;
  return (
    <View style={{ gap: 14, marginBottom: 24 }}>
      <Text style={{ color: t.text, fontSize: 20, marginTop: 24 }}>
        Scouting progress
      </Text>
      {runs.map((run) => (
        <View
          key={run.id}
          style={{
            backgroundColor: t.panel,
            borderWidth: 1,
            borderColor: t.border,
            borderRadius: 16,
            padding: 20,
            gap: 12,
          }}
        >
          <Text style={{ color: t.text, fontSize: 16 }}>{run.name}</Text>
          <Text style={{ color: t.accent, fontSize: 12 }}>
            {activeId === run.id
              ? "Searching and saving…"
              : run.status === "completed"
                ? reasons[run.reason || ""] || "Scout completed"
                : run.status === "paused"
                  ? "Paused · progress saved"
                  : "Ready to resume"}{" "}
            · {run.stats.saved || 0} / {run.target}{" "}
            {run.kind === "person" ? "people" : "companies"}
          </Text>
          <Text style={{ color: t.muted, fontSize: 12, lineHeight: 20 }}>
            {scoutProgress(run.stats)}
          </Text>
          <Text style={{ color: t.muted, fontSize: 11 }}>
            {run.stats.search_requests} provider requests ·{" "}
            {run.stats.source_blocked} pages unavailable or disallowed ·{" "}
            {run.stats.source_failed} page errors
          </Text>
          {run.warnings?.map((message) => (
            <Text
              key={message}
              style={{ color: t.muted, fontSize: 11, lineHeight: 18 }}
            >
              {message}
            </Text>
          ))}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
            {run.status !== "completed" &&
              (activeId === run.id ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onPause(run)}
                >
                  <Text style={{ color: t.accent }}>Pause scout</Text>
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  disabled={!!activeId}
                  onPress={() => onResume(run)}
                >
                  <Text style={{ color: activeId ? t.muted : t.accent }}>
                    Resume scout
                  </Text>
                </Pressable>
              ))}
            {!!run.list_id && (
              <Pressable
                accessibilityRole="button"
                onPress={() => onOpen(run.list_id!)}
              >
                <Text style={{ color: t.accent }}>View saved results ↗</Text>
              </Pressable>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}
