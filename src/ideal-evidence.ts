import type { ProspectEvidence } from "./ideal-profile.ts";
export type EvidenceStore = {
  evidenceSources?: ProspectEvidence[];
  candidateEvidence?: Record<string, string[]>;
  evidenceVersions?: Record<string, number>;
  collectEvidence?: boolean;
  collectReviews?: boolean;
  reviewTasks?: {
    id: string;
    place_id?: string;
    data_id?: string;
    url: string;
  }[];
  reviewed?: string[];
};
export function addIdealEvidence(
  store: EvidenceStore,
  ids: string[],
  source: ProspectEvidence,
) {
  if (!store.collectEvidence || !ids.length || !/^https?:\/\//.test(source.url))
    return;
  const sources = store.evidenceSources || (store.evidenceSources = []),
    refs = store.candidateEvidence || (store.candidateEvidence = {}),
    versions = store.evidenceVersions || (store.evidenceVersions = {});
  const text = source.text.replace(/\s+/g, " ").trim().slice(0, 6000);
  if (text.length < 8) return;
  const existing = sources.find(
    (s) => s.url === source.url && s.kind === source.kind,
  );
  const changed = !existing || !existing.text.includes(text);
  if (existing) {
    if (changed) existing.text = (existing.text + "\n" + text).slice(0, 10000);
  } else {
    if (sources.length >= 240) sources.shift();
    sources.push({ ...source, text });
  }
  for (const id of ids) {
    const urls = refs[id] || (refs[id] = []);
    const ref = source.kind + "|" + source.url;
    const fresh = !urls.includes(ref);
    if (fresh && urls.length < 8) urls.push(ref);
    if (fresh || changed) versions[id] = (versions[id] || 0) + 1;
  }
}
export function candidateSources(
  store: EvidenceStore,
  id: string,
): ProspectEvidence[] {
  const urls = store.candidateEvidence?.[id] || [];
  return urls
    .map((url) =>
      store.evidenceSources?.find((s) => s.kind + "|" + s.url === url),
    )
    .filter((s): s is ProspectEvidence => !!s)
    .slice(-6)
    .map((s) => ({ ...s, text: s.text.slice(0, 4500) }));
}
