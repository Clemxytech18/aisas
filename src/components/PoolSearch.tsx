import { hasProspectContact } from "../prospect-contact";
import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Modal,
  useWindowDimensions,
  ActivityIndicator,
  Linking,
} from "react-native";
import {
  Search,
  Users,
  Building2,
  SlidersHorizontal,
  X,
  ChevronDown,
  Check,
  Plus,
  ExternalLink,
  ArrowRight,
  FolderPlus,
} from "lucide-react-native";
import { supabase } from "../supabase";
import type { LeadList } from "../domain";
import {
  COMPANY_SIZES,
  INDUSTRIES,
  TECHNOLOGIES,
  DEPARTMENTS,
  SENIORITIES,
  emptyPoolFilters,
  searchPayload,
  demoPool,
  matchesProspect,
} from "../prospect-pool";
import type { PoolFilters, PoolProspect, ProspectKind } from "../prospect-pool";
type Palette = {
  bg: string;
  panel: string;
  raised: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  danger: string;
  soft: string;
};
type SaveResult = { list_id: string; added: number; skipped: number };
type Props = {
  t: Palette;
  demo: boolean;
  lists: LeadList[];
  onSave: (
    rows: PoolProspect[],
    listId: string | null,
    name: string,
  ) => Promise<SaveResult>;
  onOpenList: (id: string) => void;
  onScout: () => void;
  onSignIn: () => void;
};
const Label = ({ children, t, ...props }: any) => (
  <Text
    {...props}
    style={[{ color: t.text, fontSize: 13, lineHeight: 20 }, props.style]}
  >
    {children}
  </Text>
);
function Button({
  children,
  onPress,
  t,
  secondary = false,
  disabled = false,
}: any) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        paddingHorizontal: 16,
        paddingVertical: 11,
        borderRadius: 8,
        backgroundColor: secondary ? t.raised : t.accent,
        borderWidth: 1,
        borderColor: secondary ? t.border : t.accent,
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 8,
      })}
    >
      <Label
        t={t}
        style={{
          color: secondary ? t.text : t.accentText,
          fontWeight: "600",
          fontSize: 12,
        }}
      >
        {children}
      </Label>
    </Pressable>
  );
}
function Field({
  label,
  value,
  onChangeText,
  placeholder,
  t,
  numeric = false,
  accessibilityLabel,
}: any) {
  return (
    <View style={{ gap: 7, flexGrow: 1 }}>
      <Label t={t} style={{ fontSize: 11, color: t.muted }}>
        {label}
      </Label>
      <TextInput
        accessibilityLabel={accessibilityLabel || label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.muted}
        keyboardType={numeric ? "numeric" : "default"}
        autoCapitalize="none"
        style={{
          minHeight: 43,
          paddingHorizontal: 12,
          paddingVertical: 10,
          color: t.text,
          borderColor: t.border,
          borderWidth: 1,
          borderRadius: 7,
          backgroundColor: t.bg,
          fontSize: 12,
        }}
      />
    </View>
  );
}
function Picker({
  label,
  value,
  options,
  onChange,
  t,
  multiple = false,
  placeholder = "Any",
}: any) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const selected: string[] = multiple ? value : value ? [value] : [];
  return (
    <View style={{ gap: 7 }}>
      <Label t={t} style={{ fontSize: 11, color: t.muted }}>
        {label}
      </Label>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected.join(", ") || placeholder}`}
        onPress={() => {
          setQuery("");
          setOpen(true);
        }}
        style={{
          minHeight: 44,
          borderWidth: 1,
          borderColor: t.border,
          borderRadius: 7,
          padding: 11,
          backgroundColor: t.bg,
          flexDirection: "row",
          gap: 9,
          alignItems: "center",
        }}
      >
        <Label
          t={t}
          style={{
            flex: 1,
            fontSize: 12,
            color: selected.length ? t.text : t.muted,
          }}
        >
          {selected.join(", ") || placeholder}
        </Label>
        <ChevronDown color={t.muted} size={14} />
      </Pressable>
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
            justifyContent: "center",
            padding: 20,
          }}
        >
          <View
            accessibilityViewIsModal
            style={{
              width: "100%",
              maxWidth: 480,
              maxHeight: "85%",
              alignSelf: "center",
              padding: 22,
              gap: 15,
              borderRadius: 14,
              backgroundColor: t.panel,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Label t={t} style={{ fontSize: 18, fontWeight: "600" }}>
                {label}
              </Label>
              <Pressable
                accessibilityLabel="Close options"
                onPress={() => setOpen(false)}
                style={{ padding: 8 }}
              >
                <X size={20} color={t.text} />
              </Pressable>
            </View>
            <Field
              label="Find an option"
              value={query}
              onChangeText={setQuery}
              placeholder="Type to filter"
              t={t}
            />
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 330 }}
            >
              <Pressable
                onPress={() => {
                  onChange(multiple ? [] : "");
                  if (!multiple) setOpen(false);
                }}
                style={{ paddingVertical: 13 }}
              >
                <Label t={t}>Any / clear selection</Label>
              </Pressable>
              {options
                .filter((x: string) =>
                  x.toLowerCase().includes(query.toLowerCase()),
                )
                .map((option: string) => (
                  <Pressable
                    key={option}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected.includes(option) }}
                    onPress={() => {
                      onChange(
                        multiple
                          ? selected.includes(option)
                            ? selected.filter((x) => x !== option)
                            : [...selected, option]
                          : option,
                      );
                      if (!multiple) setOpen(false);
                    }}
                    style={{
                      paddingVertical: 13,
                      borderTopWidth: 1,
                      borderColor: t.border,
                      flexDirection: "row",
                      gap: 12,
                      alignItems: "center",
                    }}
                  >
                    <Label t={t} style={{ flex: 1 }}>
                      {option}
                    </Label>
                    {selected.includes(option) && (
                      <Check size={17} color={t.accent} />
                    )}
                  </Pressable>
                ))}
            </ScrollView>
            {multiple && (
              <Button t={t} onPress={() => setOpen(false)}>
                Apply selection
              </Button>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}
function Choice({ label, checked, onPress, t }: any) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onPress}
      style={{
        flexDirection: "row",
        gap: 9,
        alignItems: "center",
        minHeight: 38,
      }}
    >
      <View
        style={{
          height: 18,
          width: 18,
          borderRadius: 4,
          borderColor: checked ? t.accent : t.muted,
          borderWidth: 1,
          backgroundColor: checked ? t.accent : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked && <Check size={12} color={t.accentText} />}
      </View>
      <Label t={t} style={{ fontSize: 12 }}>
        {label}
      </Label>
    </Pressable>
  );
}
const amount = (n: number | null | undefined) =>
  n == null ? "Not available" : `$${Number(n).toLocaleString("en-US")}`;
export function PoolSearch({
  t,
  demo,
  lists,
  onSave,
  onOpenList,
  onScout,
  onSignIn,
}: Props) {
  const { width } = useWindowDimensions();
  const wide = width >= 1180;
  const [kind, setKind] = useState<ProspectKind>("company"),
    [filters, setFilters] = useState<PoolFilters>(emptyPoolFilters),
    [applied, setApplied] = useState<PoolFilters>(emptyPoolFilters);
  const [rows, setRows] = useState<PoolProspect[]>([]),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [hasMore, setHasMore] = useState(false),
    [offset, setOffset] = useState(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(wide),
    [saveOpen, setSaveOpen] = useState(false),
    [destination, setDestination] = useState(""),
    [newName, setNewName] = useState(""),
    [saving, setSaving] = useState(false),
    [notice, setNotice] = useState(""),
    [savedList, setSavedList] = useState("");
  const request = useRef(0);
  const alive = useRef(true);
  async function search(
    nextKind = kind,
    nextFilters = filters,
    nextOffset = 0,
  ) {
    let payload;
    try {
      payload = searchPayload(nextFilters);
    } catch (e: any) {
      setError(e.message);
      return;
    }
    const id = ++request.current;
    setLoading(true);
    setError("");
    setNotice("");
    setSelected(new Set());
    setApplied(nextFilters);
    setOffset(nextOffset);
    try {
      const result = demo
        ? (() => {
            const matches = demoPool().filter((p) =>
              matchesProspect(p, nextKind, nextFilters),
            );
            return {
              rows: matches.slice(nextOffset, nextOffset + 25),
              has_more: matches.length > nextOffset + 25,
            };
          })()
        : await (async () => {
            const r = await supabase.rpc("aisas_search_pool", {
              p_kind: nextKind,
              p_filters: payload,
              p_offset: nextOffset,
            });
            if (r.error)
              throw new Error(
                "Search is unavailable. Please retry or sign in again.",
              );
            return r.data;
          })();
      if (alive.current && id === request.current) {
        setRows((result.rows || []).filter(hasProspectContact));
        setHasMore(result.has_more);
      }
    } catch (e: any) {
      if (alive.current && id === request.current) {
        setError(e.message || "Search could not complete.");
        setRows([]);
        setHasMore(false);
      }
    } finally {
      if (alive.current && id === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void search("company", emptyPoolFilters());
    return () => {
      alive.current = false;
      request.current++;
    };
  }, [demo]);
  function update(key: keyof PoolFilters, value: any) {
    setFilters((f) => ({ ...f, [key]: value }));
  }
  function changeKind(next: ProspectKind) {
    setKind(next);
    setFilters(emptyPoolFilters());
    void search(next, emptyPoolFilters());
  }
  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  const field = (
    key: keyof PoolFilters,
    label: string,
    placeholder: string,
    numeric = false,
  ) => (
    <Field
      key={key}
      label={label}
      value={filters[key]}
      onChangeText={(v: string) => update(key, v)}
      placeholder={placeholder}
      numeric={numeric}
      t={t}
    />
  );
  const range = (prefix: "revenue" | "funding" | "founded", label: string) => (
    <View style={{ gap: 7 }}>
      <Label t={t} style={{ fontSize: 11, color: t.muted }}>
        {label}
      </Label>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Field
            t={t}
            label="Minimum"
            accessibilityLabel={`${label} minimum`}
            value={filters[`${prefix}_min`]}
            onChangeText={(value: string) => update(`${prefix}_min`, value)}
            placeholder={prefix === "founded" ? "Year" : "$ Min"}
            numeric
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            t={t}
            label="Maximum"
            accessibilityLabel={`${label} maximum`}
            value={filters[`${prefix}_max`]}
            onChangeText={(value: string) => update(`${prefix}_max`, value)}
            placeholder={prefix === "founded" ? "Year" : "$ Max"}
            numeric
          />
        </View>
      </View>
    </View>
  );
  async function save() {
    if (saving) return;
    if (!destination && (!newName.trim() || newName.trim().length > 160)) {
      setError("Enter a new list name under 160 characters.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await onSave(
        rows.filter((r) => selected.has(r.id)),
        destination || null,
        newName.trim(),
      );
      setNotice(
        `${result.added} prospect${result.added === 1 ? "" : "s"} saved${result.skipped ? `; ${result.skipped} already in that list` : ""}.`,
      );
      setSavedList(result.list_id);
      setSelected(new Set());
      setSaveOpen(false);
    } catch (e: any) {
      setError(e.message || "Could not save prospects. Please retry.");
    } finally {
      setSaving(false);
    }
  }
  const selectedCount = selected.size;
  return (
    <View style={{ gap: 20 }}>
      <View
        style={{
          padding: 20,
          backgroundColor: t.soft,
          borderRadius: 10,
          gap: 8,
        }}
      >
        <Label t={t} style={{ fontWeight: "600" }}>
          {demo
            ? "Explore the sample prospect pool"
            : "A shared starting point for your next audience"}
        </Label>
        <Label t={t} style={{ fontSize: 12, color: t.muted, lineHeight: 21 }}>
          {demo
            ? "Fictional sample data. Live scouting and the shared platform pool require sign-in."
            : "Prospects with a published email or phone are available to all signed-in users. Save a copy to your own audience lists; your campaigns and list activity remain private."}
        </Label>
        {demo && (
          <Pressable accessibilityRole="button" onPress={onSignIn}>
            <Label
              t={t}
              style={{ color: t.accent, fontSize: 12, fontWeight: "700" }}
            >
              Sign in to search live prospects →
            </Label>
          </Pressable>
        )}
      </View>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <View
          accessibilityRole="tablist"
          style={{
            flexDirection: "row",
            padding: 4,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: t.border,
            backgroundColor: t.panel,
          }}
        >
          {(
            [
              ["company", "Companies", Building2],
              ["person", "People", Users],
            ] as const
          ).map(([value, label, Icon]) => (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityState={{ selected: kind === value }}
              onPress={() => changeKind(value)}
              style={{
                paddingVertical: 12,
                paddingHorizontal: 17,
                backgroundColor: kind === value ? t.accent : "transparent",
                borderRadius: 7,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Icon size={16} color={kind === value ? t.accentText : t.muted} />
              <Label
                t={t}
                style={{
                  color: kind === value ? t.accentText : t.muted,
                  fontWeight: "600",
                  fontSize: 12,
                }}
              >
                {label}
              </Label>
            </Pressable>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: filtersOpen }}
          onPress={() => setFiltersOpen(!filtersOpen)}
          style={{ padding: 12, flexDirection: "row", gap: 8 }}
        >
          <SlidersHorizontal size={16} color={t.text} />
          <Label t={t} style={{ fontSize: 12 }}>
            {filtersOpen ? "Hide filters" : "Show filters"}
          </Label>
        </Pressable>
      </View>
      {!!notice && (
        <View
          accessibilityRole="alert"
          style={{
            padding: 16,
            borderRadius: 9,
            borderWidth: 1,
            borderColor: t.accent,
            gap: 10,
          }}
        >
          <Label t={t}>{notice}</Label>
          <Pressable onPress={() => onOpenList(savedList)}>
            <Label
              t={t}
              style={{ color: t.accent, fontSize: 12, fontWeight: "600" }}
            >
              Open audience list →
            </Label>
          </Pressable>
        </View>
      )}
      {!!error && !saveOpen && (
        <Label accessibilityRole="alert" t={t} style={{ color: t.danger }}>
          {error}
        </Label>
      )}
      <View
        style={{
          flexDirection: wide ? "row" : "column",
          alignItems: "flex-start",
          gap: 20,
        }}
      >
        {filtersOpen && (
          <View
            style={{
              width: wide ? 300 : "100%",
              backgroundColor: t.panel,
              borderColor: t.border,
              borderWidth: 1,
              borderRadius: 12,
              padding: 20,
              gap: 17,
            }}
          >
            <View
              style={{ flexDirection: "row", justifyContent: "space-between" }}
            >
              <Label t={t} style={{ fontSize: 15, fontWeight: "600" }}>
                Refine your search
              </Label>
              <Pressable
                onPress={() => {
                  const next = emptyPoolFilters();
                  setFilters(next);
                  void search(kind, next);
                }}
              >
                <Label t={t} style={{ fontSize: 11, color: t.muted }}>
                  Reset
                </Label>
              </Pressable>
            </View>
            {kind === "person" &&
              field("person", "Person name", "e.g. Alex Morgan")}
            {field("company", "Company name", "e.g. Harbor House")}
            {field("location", "Location", "e.g. Sydney, Australia")}
            {kind === "person" &&
              field(
                "job_title",
                "Job title",
                "e.g. Founder, Marketing Director",
              )}
            {kind === "person" && (
              <>
                <Picker
                  t={t}
                  label="Department"
                  value={filters.department}
                  options={DEPARTMENTS}
                  onChange={(v: string) => update("department", v)}
                />
                <Picker
                  t={t}
                  label="Seniority"
                  value={filters.seniority}
                  options={SENIORITIES}
                  onChange={(v: string) => update("seniority", v)}
                />
              </>
            )}
            <Picker
              t={t}
              label="Industry"
              placeholder="Select industry"
              value={filters.industry}
              options={INDUSTRIES}
              onChange={(v: string) => update("industry", v)}
            />
            <Picker
              t={t}
              label="Company size"
              placeholder="Select company size"
              value={filters.company_size}
              options={COMPANY_SIZES}
              onChange={(v: string) => update("company_size", v)}
            />
            {kind === "company" && (
              <>
                {range("revenue", "Annual revenue (USD)")}
                {range("funding", "Funding amount (USD)")}
                <Picker
                  t={t}
                  label="Technologies used"
                  placeholder="Select technologies"
                  value={filters.technologies}
                  options={TECHNOLOGIES}
                  multiple
                  onChange={(v: string[]) => update("technologies", v)}
                />
                {range("founded", "Year founded")}
              </>
            )}
            {field("domain", "Company domain", "e.g. www.contactout.com")}
            {field("keyword", "Keyword", "e.g. hospitality or direct bookings")}
            <View>
              <Choice
                t={t}
                label="Has an email address"
                checked={filters.has_email}
                onPress={() => update("has_email", !filters.has_email)}
              />
              <Choice
                t={t}
                label="Has a phone number"
                checked={filters.has_phone}
                onPress={() => update("has_phone", !filters.has_phone)}
              />
            </View>
            <Button t={t} disabled={loading} onPress={() => void search()}>
              {loading
                ? "Searching…"
                : `Search ${kind === "company" ? "companies" : "people"}`}
            </Button>
            <Label
              t={t}
              style={{ color: t.muted, fontSize: 10, lineHeight: 18 }}
            >
              Filters match known data only. Revenue, funding, size,
              technologies, and founding year may be unavailable in public
              search results.
            </Label>
          </View>
        )}
        <View
          style={{
            flex: wide ? 1 : undefined,
            width: wide ? undefined : "100%",
            gap: 14,
            minWidth: 0,
          }}
        >
          <View
            style={{
              backgroundColor: t.panel,
              borderColor: t.border,
              borderWidth: 1,
              padding: 16,
              borderRadius: 10,
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <View style={{ gap: 5 }}>
              <Label t={t} style={{ fontWeight: "600" }}>
                {loading
                  ? "Searching the pool…"
                  : `${rows.length} ${kind === "company" ? "companies" : "people"} on this page`}
              </Label>
              <Label t={t} style={{ fontSize: 10, color: t.muted }}>
                {selectedCount
                  ? `${selectedCount} selected`
                  : "Select prospects to save a private copy"}
              </Label>
            </View>
            <Button
              t={t}
              disabled={!selectedCount || loading}
              onPress={() => {
                setDestination(lists[0]?.id || "");
                setNewName("");
                setError("");
                setSaveOpen(true);
              }}
            >
              Save to list{selectedCount ? ` (${selectedCount})` : ""}
            </Button>
          </View>
          {loading ? (
            <View style={{ padding: 60, alignItems: "center" }}>
              <ActivityIndicator color={t.accent} />
            </View>
          ) : (
            <>
              {!!rows.length && (
                <Choice
                  t={t}
                  label="Select all on this page"
                  checked={selectedCount === rows.length}
                  onPress={() =>
                    setSelected(
                      selectedCount === rows.length
                        ? new Set()
                        : new Set(rows.map((p) => p.id)),
                    )
                  }
                />
              )}
              {rows.map((p) => (
                <View
                  key={p.id}
                  style={{
                    padding: 20,
                    borderWidth: 1,
                    borderColor: selected.has(p.id) ? t.accent : t.border,
                    borderRadius: 11,
                    backgroundColor: t.panel,
                    gap: 14,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "flex-start",
                      gap: 12,
                    }}
                  >
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityLabel={`Select ${kind === "person" ? p.contact_name : p.company}`}
                      accessibilityState={{ checked: selected.has(p.id) }}
                      onPress={() => toggle(p.id)}
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 5,
                        borderWidth: 1,
                        borderColor: selected.has(p.id) ? t.accent : t.muted,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: selected.has(p.id)
                          ? t.accent
                          : "transparent",
                      }}
                    >
                      {selected.has(p.id) && (
                        <Check color={t.accentText} size={15} />
                      )}
                    </Pressable>
                    <View style={{ flex: 1, gap: 5 }}>
                      <Label t={t} style={{ fontSize: 17, fontWeight: "600" }}>
                        {kind === "person" ? p.contact_name : p.company}
                      </Label>
                      <Label t={t} style={{ fontSize: 12, color: t.muted }}>
                        {kind === "person"
                          ? [p.job_title, p.company]
                              .filter(Boolean)
                              .join(" · ") || "Professional details unavailable"
                          : p.industry || p.category || "Industry unavailable"}
                      </Label>
                      <Label t={t} style={{ fontSize: 11, color: t.muted }}>
                        {p.location || "Location unavailable"}
                      </Label>
                    </View>
                  </View>
                  {!!p.summary && (
                    <Label
                      t={t}
                      style={{ fontSize: 12, color: t.muted }}
                      numberOfLines={3}
                    >
                      {p.summary}
                    </Label>
                  )}
                  <View style={{ gap: 5 }}>
                    <Label t={t} style={{ fontSize: 12 }}>
                      {p.email || "Email not available"}
                    </Label>
                    <Label t={t} style={{ fontSize: 12, color: t.muted }}>
                      {p.phone || "Phone not available"}
                      {p.domain ? ` · ${p.domain}` : ""}
                    </Label>
                  </View>
                  {kind === "company" && (
                    <View
                      style={{
                        flexDirection: "row",
                        flexWrap: "wrap",
                        gap: 16,
                      }}
                    >
                      {[
                        [
                          "Size",
                          p.company_size
                            ? `${p.company_size} employees`
                            : "Not available",
                        ],
                        ["Revenue", amount(p.revenue)],
                        ["Funding", amount(p.funding_amount)],
                        ["Founded", p.founded_year || "Not available"],
                      ].map(([label, value]) => (
                        <View key={label} style={{ minWidth: 95, gap: 3 }}>
                          <Label t={t} style={{ fontSize: 9, color: t.muted }}>
                            {label}
                          </Label>
                          <Label t={t} style={{ fontSize: 11 }}>
                            {value}
                          </Label>
                        </View>
                      ))}
                    </View>
                  )}
                  {!!p.technologies?.length && (
                    <Label t={t} style={{ fontSize: 11, color: t.muted }}>
                      Technologies: {p.technologies.join(", ")}
                    </Label>
                  )}
                  <View
                    style={{
                      flexDirection: "row",
                      flexWrap: "wrap",
                      gap: 16,
                      paddingTop: 12,
                      borderTopWidth: 1,
                      borderColor: t.border,
                    }}
                  >
                    {[
                      ["Source", p.source_url],
                      ["Website", p.website],
                      ["LinkedIn", p.linkedin],
                    ]
                      .filter(([, url]) => /^https?:\/\//i.test(url || ""))
                      .map(([label, url]) => (
                        <Pressable
                          key={label}
                          accessibilityRole="link"
                          onPress={() => void Linking.openURL(url)}
                          style={{
                            flexDirection: "row",
                            gap: 5,
                            alignItems: "center",
                            paddingVertical: 5,
                          }}
                        >
                          <Label
                            t={t}
                            style={{ fontSize: 11, color: t.accent }}
                          >
                            {label}
                          </Label>
                          <ExternalLink size={11} color={t.accent} />
                        </Pressable>
                      ))}
                    {kind === "company" && (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          const next = {
                            ...emptyPoolFilters(),
                            company: p.company,
                          };
                          setKind("person");
                          setFilters(next);
                          void search("person", next);
                        }}
                        style={{ paddingVertical: 5 }}
                      >
                        <Label t={t} style={{ fontSize: 11, color: t.accent }}>
                          Find decision makers →
                        </Label>
                      </Pressable>
                    )}
                  </View>
                </View>
              ))}
              {!rows.length && !error && (
                <View
                  style={{
                    borderWidth: 1,
                    borderColor: t.border,
                    borderRadius: 12,
                    padding: 32,
                    gap: 15,
                    alignItems: "flex-start",
                  }}
                >
                  <Search size={28} color={t.accent} />
                  <Label t={t} style={{ fontSize: 19, fontWeight: "500" }}>
                    No matching {kind === "company" ? "companies" : "people"}{" "}
                    yet
                  </Label>
                  <Label t={t} style={{ color: t.muted, lineHeight: 23 }}>
                    Try fewer filters or run a new AI scout. The pool grows as
                    users discover public prospects. Unknown fields are excluded
                    when their filters are active.
                  </Label>
                  <Button t={t} secondary onPress={onScout}>
                    Run an AI scout
                  </Button>
                </View>
              )}
              <View
                style={{
                  flexDirection: "row",
                  gap: 12,
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Button
                  t={t}
                  secondary
                  disabled={offset === 0}
                  onPress={() =>
                    void search(kind, applied, Math.max(0, offset - 25))
                  }
                >
                  Previous
                </Button>
                <Label t={t} style={{ color: t.muted, fontSize: 11 }}>
                  Page {Math.floor(offset / 25) + 1}
                </Label>
                <Button
                  t={t}
                  secondary
                  disabled={!hasMore || offset >= 10000}
                  onPress={() => void search(kind, applied, offset + 25)}
                >
                  Next
                </Button>
              </View>
            </>
          )}
        </View>
      </View>
      <Modal
        visible={saveOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!saving) setSaveOpen(false);
        }}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "#0009",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <View
            accessibilityViewIsModal
            style={{
              maxWidth: 500,
              width: "100%",
              alignSelf: "center",
              backgroundColor: t.panel,
              borderRadius: 14,
              padding: 24,
              gap: 18,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
              }}
            >
              <Label t={t} style={{ fontSize: 20, fontWeight: "500", flex: 1 }}>
                Save {selectedCount} prospect{selectedCount === 1 ? "" : "s"}
              </Label>
              <Pressable
                disabled={saving}
                accessibilityLabel="Close save dialog"
                onPress={() => setSaveOpen(false)}
              >
                <X size={21} color={t.muted} />
              </Pressable>
            </View>
            <Label t={t} style={{ color: t.muted, fontSize: 12 }}>
              Copies go to your own list. Repeated saves to the same list are
              skipped.
            </Label>
            <ScrollView
              style={{ maxHeight: 200 }}
              keyboardShouldPersistTaps="handled"
            >
              <Choice
                t={t}
                label="Create a new audience list"
                checked={!destination}
                onPress={() => setDestination("")}
              />
              {lists.map((l) => (
                <Choice
                  key={l.id}
                  t={t}
                  label={l.name}
                  checked={destination === l.id}
                  onPress={() => setDestination(l.id)}
                />
              ))}
            </ScrollView>
            {!destination && (
              <Field
                t={t}
                label="New list name"
                value={newName}
                onChangeText={setNewName}
                placeholder="e.g. Sydney founders"
              />
            )}
            {!!error && (
              <Label
                accessibilityRole="alert"
                t={t}
                style={{ color: t.danger }}
              >
                {error}
              </Label>
            )}
            <Button
              t={t}
              disabled={saving || !selectedCount}
              onPress={() => void save()}
            >
              {saving
                ? "Saving…"
                : demo
                  ? "Save demo prospects"
                  : "Save prospects"}
            </Button>
          </View>
        </View>
      </Modal>
    </View>
  );
}
