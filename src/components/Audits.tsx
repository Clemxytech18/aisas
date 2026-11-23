import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Platform,
  Share,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { File as ExpoFile } from "expo-file-system";
import { api } from "../supabase";
import { uid, type Lead, type LeadList } from "../domain";
import {
  AUDIT_FIELDS,
  AUDIT_LIST_LIMIT,
  blankAuditLead,
  auditLeadErrors,
  prepareAuditLeads,
  type AuditLeadInput,
  type AuditList,
  type AuditReport,
  type AuditedLead,
  type AuditField,
} from "../audits";
import {
  readLeadFile,
  importGrid,
  guessMapping,
  mapLeadRows,
  AUDIT_CSV_TEMPLATE,
  type ImportWorkbook,
} from "../audit-import";
import {
  AuditButton as Button,
  AuditFieldInput as Field,
  AuditDialog as Dialog,
  AuditSelect as Select,
  AuditReportView,
  type AuditTheme,
} from "./AuditUi";
type Detail = { list: AuditList; leads: AuditedLead[] };
type Props = {
  t: AuditTheme;
  demo: boolean;
  lists: LeadList[];
  leads: Lead[];
  openListId: string;
  onSaved: (list: AuditList, rows: AuditedLead[]) => Promise<void>;
  onCampaign: (id: string) => void;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function demoReport(l: AuditLeadInput, listId: string): AuditReport {
  return {
    lead_id: l.id,
    list_id: listId,
    status: "completed",
    cro_performance:
      "Demo audit: the sample product page could give shoppers a clearer next step. This is sample data, not a live assessment.",
    social_performance:
      "Demo: social reach and engagement have not been measured.",
    issues:
      "Sample opportunity: clarify the product page’s primary action and buying information.",
    best_offer:
      "a focused product-page review with three prioritized clarity and conversion improvements",
    evidence: [],
    findings: [],
    limitations: [
      "This is a fictional demo report. Sign in to run an audit using public-source evidence.",
    ],
    audited_at: new Date().toISOString(),
    last_error: null,
  };
}
function demoDetails(lists: LeadList[], leads: Lead[]): Record<string, Detail> {
  return Object.fromEntries(
    lists
      .filter((l) => l.kind === "audit")
      .map((l) => {
        const rows = leads
          .filter((r) => r.list_id === l.id)
          .map((r) => ({ ...blankAuditLead(r.id), ...r }) as AuditedLead);
        return [
          l.id,
          {
            list: {
              id: l.id,
              name: l.name,
              created_at: l.created_at,
              source: l.audit_source || "manual",
              status: l.audit_status || "ready",
              revision: 1,
              total: rows.length,
              completed: rows.filter(
                (r) => r.audit_report?.status === "completed",
              ).length,
              failed: 0,
              pending: 0,
              processing: 0,
            },
            leads: rows,
          },
        ];
      }),
  );
}
async function downloadCsv(text: string, name: string) {
  if (Platform.OS !== "web") {
    await Share.share({ title: name, message: text });
    return;
  }
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
function resultsCsv(rows: AuditedLead[]) {
  const keys = [
    ...AUDIT_FIELDS.map(([key]) => key),
    "cro_performance",
    "social_performance",
    "issues",
    "best_offer",
  ];
  const cell = (value: unknown) => {
    let v = String(value ?? "");
    if (/^[=+@\-\t\r]/.test(v)) v = "'" + v;
    return '"' + v.replaceAll('"', '""') + '"';
  };
  return [
    keys.map(cell).join(","),
    ...rows.map((l) =>
      keys
        .map((k) => cell(k in l ? (l as any)[k] : (l.audit_report as any)?.[k]))
        .join(","),
    ),
  ].join("\r\n");
}
export function AuditsPanel({
  t,
  demo,
  lists: workspaceLists,
  leads: workspaceLeads,
  openListId,
  onSaved,
  onCampaign,
}: Props) {
  const [demoStore, setDemoStore] = useState(() =>
    demoDetails(workspaceLists, workspaceLeads),
  );
  const [lists, setLists] = useState<AuditList[]>([]),
    [tab, setTab] = useState("lists"),
    [detail, setDetail] = useState<Detail | null>(null),
    [visible, setVisible] = useState(50);
  const [wizard, setWizard] = useState<
      "choice" | "upload" | "generate" | "review" | null
    >(null),
    [reportLead, setReportLead] = useState<AuditedLead | null>(null);
  const [staged, setStaged] = useState<AuditLeadInput[]>([]),
    [index, setIndex] = useState(0),
    [name, setName] = useState(""),
    [source, setSource] = useState<"manual" | "file" | "ai">("manual"),
    [editList, setEditList] = useState<AuditList | null>(null),
    [showErrors, setShowErrors] = useState(false);
  const [file, setFile] = useState<ImportWorkbook | null>(null),
    [sheet, setSheet] = useState(""),
    [mapping, setMapping] = useState<Record<AuditField, number> | null>(null),
    [fileName, setFileName] = useState("");
  const [terms, setTerms] = useState(""),
    [location, setLocation] = useState(""),
    [details, setDetails] = useState(""),
    [target, setTarget] = useState("25"),
    [methodChoice, setMethodChoice] = useState(false),
    [method, setMethod] = useState<"boolean" | "google_maps">("boolean"),
    [generation, setGeneration] = useState<any>(null),
    [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [generating, setGenerating] = useState(false),
    [auditing, setAuditing] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const alive = useRef(true),
    generationStop = useRef(false),
    auditStop = useRef(false),
    generationLock = useRef(false),
    auditLock = useRef(false),
    activeDetail = useRef("");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generationStop.current = true;
      auditStop.current = true;
    };
  }, []);
  async function refresh() {
    setLoading(true);
    try {
      const rows = demo
        ? Object.values(demoStore).map((d) => d.list)
        : (await api("audit-lists")).lists;
      if (alive.current) setLists(rows);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, [demo, demoStore]);
  async function open(id: string, background = false) {
    activeDetail.current = id;
    if (!background) {
      setVisible(50);
      setError("");
    }
    try {
      const data = demo
        ? demoStore[id]
        : await api("audit-detail", { list_id: id });
      if (alive.current && activeDetail.current === id) setDetail(data);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (openListId) void open(openListId);
  }, [openListId]);
  useEffect(() => {
    if (demo) return;
    const timer = setInterval(() => {
      void refresh();
      if (activeDetail.current) void open(activeDetail.current, true);
    }, 10000);
    return () => clearInterval(timer);
  }, [demo]);
  function newList() {
    setWizard("choice");
    setName("");
    setEditList(null);
    setStaged([]);
    setIndex(0);
    setShowErrors(false);
    setFile(null);
    setMapping(null);
    setError("");
    setNotice("");
    setGeneration(null);
    setMethodChoice(false);
  }
  function closeWizard() {
    generationStop.current = true;
    if (generation?.status === "running" && !demo)
      void api("audit-discover-pause", { run_id: generation.id }).catch(
        () => {},
      );
    setWizard(null);
  }
  function manual() {
    setSource("manual");
    setStaged([blankAuditLead(uid())]);
    setWizard("review");
  }
  async function pickFile() {
    setError("");
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: [
          "text/csv",
          "text/comma-separated-values",
          "application/vnd.ms-excel",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      if ((asset.size || 0) > 5 * 1024 * 1024)
        throw new Error("Choose a file smaller than 5 MB.");
      const buffer = asset.file
        ? await asset.file.arrayBuffer()
        : await new ExpoFile(asset.uri).arrayBuffer();
      const parsed = readLeadFile(buffer, asset.name);
      const first = parsed.sheets[0];
      const grid = importGrid(parsed, first);
      setFile(parsed);
      setSheet(first);
      setMapping(guessMapping(grid.headers));
      setFileName(asset.name);
      setSource("file");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function importFile() {
    if (!file || !mapping) return;
    try {
      const rows = mapLeadRows(importGrid(file, sheet), mapping, uid);
      if (!rows.length) throw new Error("The selected sheet has no lead rows.");
      setStaged(rows);
      setIndex(0);
      setShowErrors(true);
      if (!name) setName(fileName.replace(/\.[^.]+$/, ""));
      setWizard("review");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function chooseGenerate() {
    setWizard("generate");
    setSource("ai");
    if (!demo)
      try {
        setRuns((await api("audit-discover-list")).runs);
      } catch (e) {
        setError((e as Error).message);
      }
  }
  async function driveGeneration(run: any) {
    if (generationLock.current) return;
    generationLock.current = true;
    generationStop.current = false;
    setGenerating(true);
    setError("");
    try {
      let current = run;
      setGeneration(current);
      while (
        !generationStop.current &&
        alive.current &&
        current.status === "running"
      ) {
        const result = await api("audit-discover-continue", {
          run_id: current.id,
        });
        current = result.run;
        if (alive.current) setGeneration(current);
        if (result.busy) await sleep(1500);
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      generationLock.current = false;
      if (alive.current) setGenerating(false);
    }
  }
  async function generate() {
    setError("");
    try {
      if (!terms.trim() || !location.trim())
        throw new Error("Enter a business niche and location.");
      const count = Number(target);
      if (!Number.isInteger(count) || count < 1 || count > AUDIT_LIST_LIMIT)
        throw new Error(`Choose a target of 1–${AUDIT_LIST_LIMIT} leads.`);
      if (demo) {
        const row = {
          ...blankAuditLead(uid()),
          first_name: "Ada",
          email: "ada@sample-store.example",
          company: "Sample Fashion Studio",
          website: "https://sample-store.example",
          location,
          category: terms,
        };
        setGeneration({
          id: "demo-discovery",
          status: "completed",
          leads: [row],
          stats: { saved: 1 },
          warnings: ["Fictional demo leads. No live search was performed."],
        });
        return;
      }
      setGenerating(true);
      const r = await api("audit-discover-start", {
        run_id: uid(),
        terms,
        location,
        details,
        target: count,
        method,
      });
      await driveGeneration(r.run);
    } catch (e) {
      setError((e as Error).message);
      setGenerating(false);
    }
  }
  async function pauseGeneration() {
    generationStop.current = true;
    if (generation && !demo) {
      try {
        const r = await api("audit-discover-pause", { run_id: generation.id });
        setGeneration(r.run);
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }
  async function useGeneration() {
    if (!generation?.leads?.length) return;
    await pauseGeneration();
    setStaged(generation.leads);
    setIndex(0);
    setShowErrors(true);
    setName(
      name ||
        `${terms || generation.terms} · ${location || generation.location}`.slice(
          0,
          160,
        ),
    );
    setWizard("review");
  }
  async function resumeGeneration(id: string) {
    try {
      const r = await api("audit-discover-resume", { run_id: id });
      setTerms(r.run.terms);
      setLocation(r.run.location);
      setMethod(r.run.method);
      setMethodChoice(true);
      await driveGeneration(r.run);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function save() {
    setSaving(true);
    setShowErrors(true);
    setError("");
    try {
      if (!name.trim() || name.trim().length > 160)
        throw new Error("Give this list a name of 1–160 characters.");
      const rows = prepareAuditLeads(staged);
      const id = editList?.id || uid();
      if (demo) {
        const savedRows = rows.map((r) => ({
          ...r,
          list_id: id,
          audit_report: null,
        }));
        const list: AuditList = {
          id,
          name: name.trim(),
          source,
          status: "ready",
          revision: (editList?.revision || 0) + 1,
          created_at: editList?.created_at || new Date().toISOString(),
          total: rows.length,
          completed: 0,
          failed: 0,
          processing: 0,
          pending: 0,
        };
        setDemoStore((old) => ({ ...old, [id]: { list, leads: savedRows } }));
        await onSaved(list, savedRows);
        setDetail({ list, leads: savedRows });
        activeDetail.current = id;
      } else {
        await api("audit-save", {
          list_id: id,
          name: name.trim(),
          source,
          leads: rows,
          revision: editList?.revision,
        });
        const data = await api("audit-detail", { list_id: id });
        await onSaved(data.list, data.leads);
        setDetail(data);
        activeDetail.current = id;
        await refresh();
      }
      setWizard(null);
      setNotice("List saved. Review its leads or run an audit when ready.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  function edit() {
    if (!detail) return;
    setEditList(detail.list);
    setName(detail.list.name);
    setSource(detail.list.source);
    setStaged(detail.leads.map((r) => ({ ...blankAuditLead(r.id), ...r })));
    setIndex(0);
    setShowErrors(false);
    setError("");
    setWizard("review");
  }
  async function runAudit(list: AuditList) {
    if (auditLock.current) return;
    auditLock.current = true;
    auditStop.current = false;
    setAuditing(true);
    setError("");
    try {
      if (demo) {
        const current = demoStore[list.id];
        const rows = current.leads.map((l) => ({
          ...l,
          audit_report: demoReport(l, list.id),
        }));
        const next = {
          list: {
            ...list,
            status: "audited" as const,
            completed: rows.length,
            pending: 0,
            processing: 0,
          },
          leads: rows,
        };
        setDemoStore((old) => ({ ...old, [list.id]: next }));
        await onSaved(next.list, rows);
        activeDetail.current = list.id;
        setDetail(next);
        setTab("audited");
        setNotice(
          "Demo audit completed with sample findings. No live website or social audit was performed.",
        );
        return;
      }
      if (list.status !== "auditing") {
        const started = await api("audit-start", { list_id: list.id });
        if (activeDetail.current === list.id) setDetail(started);
      }
      setNotice(
        "Audit started. Progress is saved and background processing continues if you leave this screen.",
      );
      let current = await api("audit-detail", { list_id: list.id });
      while (
        alive.current &&
        !auditStop.current &&
        current.list.status === "auditing"
      ) {
        const result = await api("audit-step", { list_id: list.id });
        current = result;
        if (activeDetail.current === list.id) setDetail(result);
        setLists((old) => old.map((l) => (l.id === list.id ? result.list : l)));
        if (!result.processed) await sleep(1500);
      }
      if (alive.current) {
        await refresh();
        await onSaved(current.list, current.leads);
        if (current.list.status === "audited") {
          setTab("audited");
          setNotice(
            "Audit complete. This list is now available in campaign creation.",
          );
        } else if (current.list.status === "partial")
          setNotice(
            "Some audits could not finish. Review the errors and retry when ready.",
          );
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      auditLock.current = false;
      if (alive.current) setAuditing(false);
    }
  }
  const text = { color: t.text, fontSize: 16, lineHeight: 25 } as const,
    muted = { ...text, color: t.muted, fontSize: 14 } as const;
  const card = {
    backgroundColor: t.panel,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 15,
    padding: 20,
    gap: 14,
  };
  const current = staged[index],
    errors = current ? auditLeadErrors(current) : {};
  const invalid = staged.filter(
    (l) => Object.keys(auditLeadErrors(l)).length,
  ).length;
  const banner = error ? (
    <Text accessibilityRole="alert" style={{ ...muted, color: t.danger }}>
      {error}
    </Text>
  ) : null;
  const filtered = lists.filter((l) =>
    tab === "audited" ? l.status === "audited" : l.status !== "audited",
  );
  return (
    <View style={{ gap: 22 }}>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 15,
        }}
      >
        <View style={{ flex: 1, minWidth: 200 }}>
          <Text style={{ color: t.text, fontSize: 28, fontWeight: "600" }}>
            Audits
          </Text>
          <Text style={[muted, { marginTop: 8 }]}>
            Turn lead lists into relevant offers and better conversations.
          </Text>
        </View>
        <Button t={t} onPress={newList}>
          New list
        </Button>
      </View>
      {demo && (
        <Text
          style={[
            muted,
            { padding: 14, backgroundColor: t.soft, borderRadius: 10 },
          ]}
        >
          Demo workspace · Lists and audit results are samples. Sign in for live
          AI discovery and audits.
        </Text>
      )}
      {banner}
      {!!notice && (
        <Text
          accessibilityLiveRegion="polite"
          style={{ ...muted, color: t.accent }}
        >
          {notice}
        </Text>
      )}
      {!detail ? (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
            <Button
              t={t}
              secondary={tab !== "lists"}
              onPress={() => setTab("lists")}
            >
              Lists ({lists.filter((l) => l.status !== "audited").length})
            </Button>
            <Button
              t={t}
              secondary={tab !== "audited"}
              onPress={() => setTab("audited")}
            >
              Audited Lists (
              {lists.filter((l) => l.status === "audited").length})
            </Button>
            <Button
              t={t}
              secondary
              onPress={() => void refresh()}
              busy={loading}
            >
              Refresh lists
            </Button>
          </View>
          {filtered.map((l) => (
            <View key={l.id} style={card}>
              <View style={{ gap: 7 }}>
                <Text style={{ ...text, fontSize: 21, fontWeight: "600" }}>
                  {l.name}
                </Text>
                <Text style={muted}>
                  {l.total} leads ·{" "}
                  {l.source === "ai"
                    ? "AI discovery"
                    : l.source === "file"
                      ? "File import"
                      : "Manual list"}{" "}
                  ·{" "}
                  {l.status === "audited"
                    ? "Audited"
                    : l.status === "auditing"
                      ? "Audit in progress"
                      : l.status === "partial"
                        ? "Needs attention"
                        : "Ready to audit"}
                </Text>
                {l.status === "auditing" && (
                  <Text style={{ ...muted, color: t.accent }}>
                    {l.completed} / {l.total} completed · {l.processing}{" "}
                    processing · {l.failed} failed
                  </Text>
                )}
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
                <Button t={t} secondary onPress={() => void open(l.id)}>
                  Open list
                </Button>
                <Button
                  t={t}
                  secondary
                  disabled={!l.completed && !l.failed}
                  onPress={() => void open(l.id)}
                >
                  Audit result
                </Button>
                <Button
                  t={t}
                  disabled={auditing}
                  onPress={() => void runAudit(l)}
                >
                  {l.status === "auditing"
                    ? "Continue audit"
                    : l.status === "audited"
                      ? "Re-audit list"
                      : "Audit list"}
                </Button>
                {l.status === "audited" && (
                  <Button t={t} onPress={() => onCampaign(l.id)}>
                    Create campaign
                  </Button>
                )}
              </View>
            </View>
          ))}
          {!loading && !filtered.length && (
            <View style={[card, { alignItems: "center", paddingVertical: 40 }]}>
              <Text style={{ ...text, fontSize: 21, fontWeight: "600" }}>
                {tab === "audited"
                  ? "Your audited lists will appear here"
                  : "Start with a lead list"}
              </Text>
              <Text style={[muted, { textAlign: "center", maxWidth: 550 }]}>
                {tab === "audited"
                  ? "Complete a list’s audit to use its findings and Best Offers in a campaign."
                  : "Upload a CSV or Excel file, add leads manually, or discover businesses with AI. Review and save your leads before auditing."}
              </Text>
              <Button t={t} onPress={newList}>
                Create a new list
              </Button>
            </View>
          )}
        </>
      ) : (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
            <Button
              t={t}
              secondary
              onPress={() => {
                activeDetail.current = "";
                setDetail(null);
              }}
            >
              Back to lists
            </Button>
            <Button
              t={t}
              secondary
              disabled={detail.list.locked || auditing}
              onPress={edit}
            >
              Edit leads
            </Button>
            <Button
              t={t}
              secondary
              onPress={() =>
                void downloadCsv(
                  resultsCsv(detail.leads),
                  `${detail.list.name}-audit.csv`,
                )
              }
            >
              Export list & results
            </Button>
            <Button
              t={t}
              busy={auditing}
              onPress={() => void runAudit(detail.list)}
            >
              {detail.list.status === "auditing"
                ? "Continue audit"
                : detail.list.status === "audited"
                  ? "Re-audit list"
                  : "Audit list"}
            </Button>
            {detail.list.status === "audited" && (
              <Button t={t} onPress={() => onCampaign(detail.list.id)}>
                Create campaign
              </Button>
            )}
          </View>
          <View style={card}>
            <Text style={{ ...text, fontSize: 24, fontWeight: "600" }}>
              {detail.list.name}
            </Text>
            <Text style={muted}>
              {detail.leads.length} leads · {detail.list.completed} audits
              completed · {detail.list.failed} failed
            </Text>
            {detail.list.locked && (
              <Text style={muted}>
                Pause campaigns using this list before editing its leads.
              </Text>
            )}
            {detail.list.status === "auditing" && (
              <View style={{ gap: 10 }}>
                <ActivityIndicator color={t.accent} />
                <Text style={muted}>
                  Auditing public website and social evidence. You can leave
                  this screen and return to the saved progress.
                </Text>
              </View>
            )}
          </View>
          {detail.leads.slice(0, visible).map((l) => (
            <View key={l.id} style={card}>
              <Text style={{ ...text, fontSize: 20, fontWeight: "600" }}>
                {l.first_name} {l.last_name} · {l.company}
              </Text>
              <Text selectable style={muted}>
                {l.email}
              </Text>
              <Text selectable style={muted}>
                {l.website}
              </Text>
              <Text style={muted}>
                {[
                  l.instagram_url && "Instagram",
                  l.tiktok_url && "TikTok",
                  l.facebook_url && "Facebook",
                  l.linkedin && "LinkedIn",
                ]
                  .filter(Boolean)
                  .join(" · ") || "No social links supplied"}
              </Text>
              {l.audit_report && (
                <>
                  <Text
                    style={{
                      ...muted,
                      color:
                        l.audit_report.status === "failed"
                          ? t.danger
                          : t.accent,
                    }}
                  >
                    Audit: {l.audit_report.status}
                  </Text>
                  {l.audit_report.last_error && (
                    <Text style={{ ...muted, color: t.danger }}>
                      {l.audit_report.last_error}
                    </Text>
                  )}
                  {l.audit_report.status === "completed" && (
                    <>
                      {[
                        ["CRO performance", l.audit_report.cro_performance],
                        [
                          "Social Performance",
                          l.audit_report.social_performance,
                        ],
                        ["Issues", l.audit_report.issues],
                        ["Best Offer", l.audit_report.best_offer],
                      ].map(([label, value]) => (
                        <View key={label} style={{ gap: 5 }}>
                          <Text
                            style={{
                              ...muted,
                              fontWeight: "600",
                              color: label === "Best Offer" ? t.accent : t.text,
                            }}
                          >
                            {label}
                          </Text>
                          <Text numberOfLines={3} style={muted}>
                            {value}
                          </Text>
                        </View>
                      ))}
                    </>
                  )}
                  <View style={{ alignItems: "flex-start" }}>
                    <Button
                      t={t}
                      secondary
                      disabled={
                        l.audit_report.status === "pending" ||
                        l.audit_report.status === "processing"
                      }
                      onPress={() => setReportLead(l)}
                    >
                      View audit result
                    </Button>
                  </View>
                </>
              )}
            </View>
          ))}
          {detail.leads.length > visible && (
            <Button t={t} secondary onPress={() => setVisible((v) => v + 50)}>
              Load more leads
            </Button>
          )}
        </>
      )}
      {wizard && (
        <Dialog
          t={t}
          wide
          title={
            wizard === "choice"
              ? "Create a new list"
              : wizard === "upload"
                ? "Upload leads"
                : wizard === "generate"
                  ? "Generate with AI"
                  : "Review and save list"
          }
          onClose={closeWizard}
        >
          {banner}
          {wizard === "choice" && (
            <>
              <Text style={text}>How would you like to build this list?</Text>
              <Button t={t} onPress={() => setWizard("upload")}>
                Upload Lead
              </Button>
              <Text style={muted}>
                Add leads manually or import a CSV or Excel file.
              </Text>
              <Button t={t} secondary onPress={() => void chooseGenerate()}>
                Generate with AI
              </Button>
              <Text style={muted}>
                Find businesses by niche and location, using Boolean or Google
                Maps discovery.
              </Text>
            </>
          )}
          {wizard === "upload" && (
            <>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
                <Button t={t} onPress={manual}>
                  Add manually
                </Button>
                <Button t={t} secondary onPress={() => void pickFile()}>
                  Upload CSV or Excel
                </Button>
                <Button
                  t={t}
                  secondary
                  onPress={() =>
                    void downloadCsv(
                      AUDIT_CSV_TEMPLATE,
                      "aisas-audit-leads-template.csv",
                    )
                  }
                >
                  Download CSV template
                </Button>
              </View>
              <Text style={muted}>
                CSV, .xlsx and .xls · Up to 5 MB and {AUDIT_LIST_LIMIT} leads
                per list. Choose the sheet and map its columns before reviewing
                your leads.
              </Text>
              {file && mapping && (
                <>
                  <Text style={text}>{fileName}</Text>
                  <Select
                    t={t}
                    label="Worksheet"
                    value={sheet}
                    options={file.sheets.map((value) => ({
                      value,
                      label: value,
                    }))}
                    onChange={(value: string) => {
                      try {
                        const grid = importGrid(file, value);
                        setSheet(value);
                        setMapping(guessMapping(grid.headers));
                        setError("");
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  />
                  <Text style={{ ...text, fontWeight: "600" }}>
                    Map your columns
                  </Text>
                  {AUDIT_FIELDS.map(([key, label, required]) => (
                    <Select
                      key={key}
                      t={t}
                      label={`${label}${required ? " *" : " (optional)"}`}
                      value={mapping[key]}
                      options={[
                        {
                          value: -1,
                          label: "Not in this file — fill during review",
                        },
                        ...importGrid(file, sheet).headers.map((h, i) => ({
                          value: i,
                          label: `${h} (column ${i + 1})`,
                        })),
                      ]}
                      onChange={(value: number) =>
                        setMapping((old) =>
                          old ? { ...old, [key]: value } : old,
                        )
                      }
                    />
                  ))}
                  <Button t={t} onPress={importFile}>
                    Review imported leads
                  </Button>
                </>
              )}
            </>
          )}
          {wizard === "generate" && (
            <>
              <Field
                t={t}
                label="Target business niche *"
                value={terms}
                onChangeText={setTerms}
                placeholder="Fashion store owners"
              />
              <Field
                t={t}
                label="Location *"
                value={location}
                onChangeText={setLocation}
                placeholder="New York, USA"
              />
              <Field
                t={t}
                multiline
                label="Additional search details (optional)"
                value={details}
                onChangeText={setDetails}
                placeholder="Business types, specialties, or public contact details to look for"
              />
              <Field
                t={t}
                label="Target number of leads"
                keyboardType="numeric"
                value={target}
                onChangeText={setTarget}
              />
              {!methodChoice ? (
                <Button
                  t={t}
                  onPress={() => {
                    if (!terms.trim() || !location.trim()) {
                      setError("Enter the business niche and location first.");
                      return;
                    }
                    setError("");
                    setMethodChoice(true);
                  }}
                >
                  Generate
                </Button>
              ) : (
                <>
                  <Text style={{ ...text, fontWeight: "600" }}>
                    Choose how AI should discover the leads
                  </Text>
                  <Select
                    t={t}
                    label="Discovery method"
                    value={method}
                    options={[
                      {
                        value: "boolean",
                        label: "Boolean — public web and business sources",
                      },
                      {
                        value: "google_maps",
                        label:
                          "Google Maps — local businesses and their websites",
                      },
                    ]}
                    onChange={setMethod}
                  />
                  <Button
                    t={t}
                    busy={generating}
                    onPress={() => void generate()}
                  >
                    {demo ? "Generate sample leads" : "Start AI generation"}
                  </Button>
                </>
              )}
              {generating && (
                <Button t={t} secondary onPress={() => void pauseGeneration()}>
                  Pause generation
                </Button>
              )}
              {generation && (
                <View style={{ ...card, backgroundColor: t.bg }}>
                  <Text style={text}>
                    {generation.leads?.length || 0} leads found ·{" "}
                    {generation.status}
                  </Text>
                  <Text style={muted}>
                    {generation.stats?.search_pages || 0} search pages ·{" "}
                    {generation.stats?.source_pages || 0} website pages reviewed
                  </Text>
                  {generation.warnings?.map((w: string, i: number) => (
                    <Text key={i} style={muted}>
                      {w}
                    </Text>
                  ))}
                  <Text style={muted}>
                    Only source-backed details are used. Missing first names,
                    emails or websites must be completed before saving.
                  </Text>
                  <Button
                    t={t}
                    disabled={!generation.leads?.length}
                    onPress={() => void useGeneration()}
                  >
                    Review these leads
                  </Button>
                </View>
              )}
              {!generating && runs.length > 0 && (
                <>
                  <Text style={{ ...text, fontWeight: "600" }}>
                    Saved discovery runs
                  </Text>
                  {runs.map((r) => (
                    <Button
                      key={r.id}
                      t={t}
                      secondary
                      onPress={() => void resumeGeneration(r.id)}
                    >
                      {r.terms} · {r.location} ·{" "}
                      {r.status === "completed" ? "Open results" : "Resume"}
                    </Button>
                  ))}
                </>
              )}
            </>
          )}
          {wizard === "review" && (
            <>
              <Field
                t={t}
                label="List name *"
                value={name}
                onChangeText={setName}
                maxLength={160}
                placeholder="e.g. New York fashion stores"
              />
              <Text style={muted}>
                {staged.length} leads · {invalid} need required details.
                Firstname, Email, Business name and Website URL are required.
                Lastname and social links are optional.
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
                <Button
                  t={t}
                  secondary
                  disabled={staged.length >= AUDIT_LIST_LIMIT}
                  onPress={() => {
                    setStaged((old) => [...old, blankAuditLead(uid())]);
                    setIndex(staged.length);
                  }}
                >
                  Add another lead
                </Button>
                <Button
                  t={t}
                  secondary
                  disabled={!current}
                  onPress={() => {
                    if (staged.length === 1) {
                      setStaged([blankAuditLead(uid())]);
                      setIndex(0);
                    } else {
                      setStaged((old) => old.filter((_, i) => i !== index));
                      setIndex((i) => Math.max(0, i - 1));
                    }
                  }}
                >
                  Remove this lead
                </Button>
              </View>
              {current && (
                <>
                  <Select
                    t={t}
                    label="Lead to edit"
                    value={index}
                    options={staged.map((l, i) => ({
                      value: i,
                      label: `${i + 1}. ${l.company || "New lead"} · ${l.first_name || "Firstname needed"}`,
                    }))}
                    onChange={setIndex}
                  />
                  {AUDIT_FIELDS.map(([key, label, required]) => (
                    <Field
                      key={key}
                      t={t}
                      label={`${label}${required ? " *" : " (optional)"}`}
                      value={current[key]}
                      error={showErrors ? errors[key] : undefined}
                      autoCapitalize={
                        key.includes("name") || key === "company"
                          ? "words"
                          : "none"
                      }
                      keyboardType={
                        key === "email" ? "email-address" : "default"
                      }
                      onChangeText={(value: string) =>
                        setStaged((old) =>
                          old.map((row, i) =>
                            i === index ? { ...row, [key]: value } : row,
                          ),
                        )
                      }
                    />
                  ))}
                  <View
                    style={{
                      flexDirection: "row",
                      gap: 9,
                      justifyContent: "space-between",
                    }}
                  >
                    <Button
                      t={t}
                      secondary
                      disabled={index === 0}
                      onPress={() => setIndex((i) => i - 1)}
                    >
                      Previous lead
                    </Button>
                    <Button
                      t={t}
                      secondary
                      disabled={index >= staged.length - 1}
                      onPress={() => setIndex((i) => i + 1)}
                    >
                      Next lead
                    </Button>
                  </View>
                </>
              )}
              <Text style={muted}>
                Saving keeps this list private and adds the leads to “My audit
                leads” in Search. You can audit the saved list when ready.
              </Text>
              <Button t={t} busy={saving} onPress={() => void save()}>
                Save list
              </Button>
            </>
          )}
        </Dialog>
      )}
      {reportLead?.audit_report && (
        <Dialog
          t={t}
          title={`Audit result · ${reportLead.company}`}
          wide
          onClose={() => setReportLead(null)}
        >
          <AuditReportView report={reportLead.audit_report} t={t} />
        </Dialog>
      )}
    </View>
  );
}

export function AuditSearch({
  t,
  demo,
  lists,
  leads,
  onOpen,
}: {
  t: AuditTheme;
  demo: boolean;
  lists: LeadList[];
  leads: Lead[];
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [audited, setAudited] = useState(false),
    [rows, setRows] = useState<any[]>([]),
    [offset, setOffset] = useState(0),
    [more, setMore] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const version = useRef(0);
  async function search(next = 0) {
    const v = ++version.current;
    setLoading(true);
    setError("");
    try {
      let r;
      if (demo) {
        const ids = new Set(
          lists.filter((l) => l.kind === "audit").map((l) => l.id),
        );
        const found = leads.filter(
          (l) =>
            ids.has(l.list_id) &&
            (!audited || l.audit_report?.status === "completed") &&
            (!query.trim() ||
              [
                l.first_name,
                l.last_name,
                l.company,
                l.email,
                l.website,
                l.audit_report?.issues,
                l.audit_report?.best_offer,
              ]
                .join(" ")
                .toLowerCase()
                .includes(query.toLowerCase().trim())),
        );
        r = {
          rows: found.slice(next, next + 25).map((l) => ({
            ...l,
            list_name: lists.find((x) => x.id === l.list_id)?.name,
          })),
          has_more: found.length > next + 25,
        };
      } else r = await api("audit-search", { query, offset: next, audited });
      if (v === version.current) {
        setRows(r.rows);
        setMore(r.has_more);
        setOffset(next);
      }
    } catch (e) {
      if (v === version.current) setError((e as Error).message);
    } finally {
      if (v === version.current) setLoading(false);
    }
  }
  useEffect(() => {
    const timer = setTimeout(() => void search(), 250);
    return () => {
      clearTimeout(timer);
      version.current++;
    };
  }, [query, audited, demo, lists, leads]);
  return (
    <View style={{ gap: 18 }}>
      <Text style={{ color: t.text, fontSize: 24, fontWeight: "600" }}>
        My audit leads
      </Text>
      <Text style={{ color: t.muted, fontSize: 15, lineHeight: 24 }}>
        Search your uploaded, manually added and AI-generated audit leads. These
        contacts and their audit findings are private to your account.
      </Text>
      <Field
        t={t}
        label="Search audit leads"
        value={query}
        onChangeText={setQuery}
        placeholder="Name, email, business, website, issue or Best Offer"
      />
      <View style={{ alignItems: "flex-start" }}>
        <Button
          t={t}
          secondary={!audited}
          onPress={() => setAudited((v) => !v)}
        >
          {audited ? "Audited leads only" : "All audit leads"}
        </Button>
      </View>
      {!!error && (
        <Text
          accessibilityRole="alert"
          style={{ color: t.danger, fontSize: 14 }}
        >
          {error}
        </Text>
      )}
      {loading && <ActivityIndicator color={t.accent} />}{" "}
      {!loading && !rows.length && (
        <Text style={{ color: t.muted, fontSize: 16 }}>
          No matching audit leads yet. Create or import a list under Audits.
        </Text>
      )}
      {rows.map((l) => (
        <View
          key={l.id}
          style={{
            padding: 20,
            borderWidth: 1,
            borderColor: t.border,
            borderRadius: 13,
            backgroundColor: t.panel,
            gap: 10,
          }}
        >
          <Text style={{ color: t.text, fontSize: 19, fontWeight: "600" }}>
            {l.first_name} {l.last_name} · {l.company}
          </Text>
          <Text selectable style={{ color: t.muted, fontSize: 15 }}>
            {l.email}
          </Text>
          <Text selectable style={{ color: t.muted, fontSize: 14 }}>
            {l.website}
          </Text>
          <Text style={{ color: t.muted, fontSize: 14 }}>
            {l.list_name} · {l.audit_report?.status || "Not audited"}
          </Text>
          {l.audit_report?.status === "completed" && (
            <>
              <Text
                numberOfLines={3}
                style={{ color: t.text, fontSize: 15, lineHeight: 23 }}
              >
                {l.audit_report.issues}
              </Text>
              <Text
                numberOfLines={3}
                style={{ color: t.accent, fontSize: 15, lineHeight: 23 }}
              >
                Best Offer: {l.audit_report.best_offer}
              </Text>
            </>
          )}
          <View style={{ alignItems: "flex-start" }}>
            <Button t={t} secondary onPress={() => onOpen(l.list_id)}>
              Open audit list
            </Button>
          </View>
        </View>
      ))}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <Button
          t={t}
          secondary
          disabled={offset === 0 || loading}
          onPress={() => void search(Math.max(0, offset - 25))}
        >
          Previous
        </Button>
        <Button
          t={t}
          secondary
          disabled={!more || loading}
          onPress={() => void search(offset + 25)}
        >
          Next
        </Button>
      </View>
    </View>
  );
}
