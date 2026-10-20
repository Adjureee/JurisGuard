import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import MainLayout from "../../layouts/MainLayout";
import {
  listOwnerCandidates,
  listUnresolvedClientOwners,
  resolveClientOwner,
  type OwnerCandidate,
  type UnresolvedClientOwner,
} from "../../services/adminService";

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "response" in error) {
    const response = (error as { response?: { status?: number; data?: { detail?: string } } }).response;
    if (response?.status === 409) return "This client was resolved by another administrator. Reload the list before proceeding.";
    if (response?.data?.detail) return response.data.detail;
  }
  return error instanceof Error ? error.message : "Request failed";
}

export default function OwnershipResolutionPage() {
  const navigate = useNavigate();
  const [records, setRecords] = useState<UnresolvedClientOwner[]>([]);
  const [owners, setOwners] = useState<OwnerCandidate[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [ownerId, setOwnerId] = useState("");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    const [unresolved, candidates] = await Promise.all([listUnresolvedClientOwners(), listOwnerCandidates()]);
    setRecords(unresolved);
    setOwners(candidates);
    setSelectedId((current) => unresolved.some((item) => item.client_id === current) ? current : null);
  }

  useEffect(() => {
    let active = true;
    Promise.all([listUnresolvedClientOwners(), listOwnerCandidates()])
      .then(([unresolved, candidates]) => {
        if (active) { setRecords(unresolved); setOwners(candidates); }
      })
      .catch((err: unknown) => { if (active) setError(errorMessage(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const selected = records.find((item) => item.client_id === selectedId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !ownerId || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await resolveClientOwner(selected.client_id, Number(ownerId), reason.trim(), evidence.trim());
      setNotice(`Owner recorded for client #${selected.client_id}. Review the server audit log for the evidence reference.`);
      setSelectedId(null);
      setOwnerId(""); setReason(""); setEvidence("");
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
      try { await refresh(); } catch { /* Keep the conflict/error visible until the next manual reload. */ }
    } finally {
      setSaving(false);
    }
  }

  return <MainLayout>
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Resolve legacy client ownership</h1>
        <p className="mt-2 text-sm text-slate-600">Interviewers are access context, not proof of who created the client. Investigate trusted records before assigning an owner. Changes cannot be overwritten here.</p>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-green-800">{notice}</p>}
      {loading ? <p>Loading unresolved clients…</p> : <>
        <section className="rounded-xl border bg-white p-5">
          <h2 className="text-lg font-semibold">Unresolved clients ({records.length})</h2>
          {records.length === 0 ? <p className="mt-3 text-sm">No unresolved client owners.</p> :
            <ul className="mt-4 space-y-3">{records.map((item) => <li key={item.client_id} className="rounded-lg border p-3 text-sm">
              <p className="font-semibold">Client #{item.client_id}: {item.name}</p>
              <p>Created: {item.created_at ? new Date(item.created_at).toLocaleString() : "Unknown"}</p>
              <p>Interviewers: {item.interviewers.map((person) => `${person.full_name || `User #${person.user_id}`} (#${person.user_id})`).join(", ") || "None recorded"}</p>
              <p>Linked cases: {item.case_ids.join(", ") || "None recorded"}</p>
              <button type="button" className="mt-2 rounded bg-purple-700 px-3 py-2 font-semibold text-white" onClick={() => {
                setSelectedId(item.client_id); setOwnerId(""); setReason(""); setEvidence(""); setError(""); setNotice("");
              }}>Investigate client #{item.client_id}</button>
            </li>)}</ul>}
          <button type="button" className="mt-4 text-sm font-semibold text-purple-800 underline" onClick={() => { setError(""); void refresh().catch((err: unknown) => setError(errorMessage(err))); }}>Reload list</button>
        </section>
        {selected && <form onSubmit={(event) => void submit(event)} className="space-y-4 rounded-xl border bg-white p-5">
          <h2 className="text-lg font-semibold">Assign owner for client #{selected.client_id}</h2>
          <p className="text-sm">Review linked case records and independent supporting evidence. Do not use an audit entry alone as ownership proof.</p>
          <button type="button" className="text-sm text-purple-800 underline" onClick={() => navigate(`/criminal-cases`)}>Open case records</button>
          <label className="block text-sm font-semibold">Eligible owner
            <select required value={ownerId} onChange={(event) => setOwnerId(event.target.value)} className="mt-1 block w-full rounded border p-2">
              <option value="">Select approved staff</option>
              {owners.map((person) => <option key={person.user_id} value={person.user_id}>{person.full_name || person.email} (#{person.user_id})</option>)}
            </select>
          </label>
          <label className="block text-sm font-semibold">Reason for assigning this owner
            <textarea required minLength={10} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 block w-full rounded border p-2" />
          </label>
          <label className="block text-sm font-semibold">Trusted supporting evidence reference (internal record ID, not a document's contents)
            <input required minLength={3} maxLength={500} value={evidence} onChange={(event) => setEvidence(event.target.value)} className="mt-1 block w-full rounded border p-2" />
          </label>
          <button type="submit" disabled={saving || !ownerId} className="rounded bg-purple-700 px-4 py-2 font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Record owner and audit decision"}</button>
        </form>}
      </>}
    </div>
  </MainLayout>;
}
