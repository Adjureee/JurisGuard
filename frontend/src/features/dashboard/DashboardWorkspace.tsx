import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, FileScan, Search, RefreshCw } from 'lucide-react';
import MainLayout from '../../layouts/MainLayout';
import { SkeletonBlock } from '../../components/dashboard/AnalyticsPrimitives';
import { useAuth } from '../../contexts/AuthContext';
import { getDashboardOverview, getRecentActivities, getStaffWorkload, type DashboardOverview, type RecentActivity, type StaffWorkload } from '../../services/dashboardService';
import { listCaseSubmissions, type CaseSubmission } from '../../services/caseSubmissionService';
import { AdminReminders } from './AdminReminders';
import './dashboard.css';

export function dashboardDate(value?: string) {
  if (!value) return 'Date not recorded';
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? 'Date not recorded' : new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }).format(date);
}
const needsReview = new Set(['Submitted', 'Under Review', 'Resubmitted']);
const requiresCorrection = new Set(['Correction Required', 'Correction Requested']);
const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[#CBD5E1] bg-white px-4 py-2 text-sm font-semibold text-[#334155] hover:bg-[#F8FAFC]';

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="min-w-0 rounded-xl border border-[#DDE3EA] bg-white"><header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E7EB] px-5 py-4"><h2 className="text-lg font-semibold text-[#172534]">{title}</h2>{action}</header><div className="p-5">{children}</div></section>;
}

export default function DashboardWorkspace({ admin }: { admin: boolean }) {
  const { user } = useAuth();
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [workload, setWorkload] = useState<StaffWorkload | null>(null);
  const [activities, setActivities] = useState<RecentActivity[]>([]);
  const [submissions, setSubmissions] = useState<CaseSubmission[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErrors([]);
    // Clear previous-user values before fetching role-scoped data.
    setOverview(null); setWorkload(null); setActivities([]); setSubmissions(null);
    async function load() {
      const failures: string[] = [];
      if (admin) {
        const results = await Promise.allSettled([getDashboardOverview(), getRecentActivities(), listCaseSubmissions()]);
        if (cancelled) return;
        const [summary, recent, reports] = results;
        if (summary.status === 'fulfilled') setOverview(summary.value); else failures.push('Workload summary');
        if (recent.status === 'fulfilled') setActivities(recent.value); else failures.push('Recent activity');
        if (reports.status === 'fulfilled') setSubmissions(reports.value); else failures.push('Reports');
      } else {
        const results = await Promise.allSettled([getStaffWorkload(), listCaseSubmissions()]);
        if (cancelled) return;
        if (results[0].status === 'fulfilled') setWorkload(results[0].value); else failures.push('Your workload');
        if (results[1].status === 'fulfilled') setSubmissions(results[1].value); else failures.push('Your reports');
      }
      setErrors(failures); setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [admin, user?.user_id, revision]);

  const pending = (submissions ?? []).filter(s => admin ? needsReview.has(s.status) : requiresCorrection.has(s.status));
  const recent = (admin ? activities : workload?.recent_actions ?? []).slice().sort((a,b) => Date.parse(b.timestamp)-Date.parse(a.timestamp)).slice(0,5);
  const metrics = admin ? [
    { label: 'Active cases', value: overview?.active_cases, detail: 'Current open case workload' },
    { label: 'Registered clients', value: overview?.total_clients, detail: 'Client profiles, with or without a case' },
    { label: 'Total cases', value: overview?.total_cases, detail: overview ? `${overview.terminated_cases} terminated` : 'All recorded case types' },
    { label: 'Cases this month', value: overview?.cases_this_month, detail: 'By case date; last update if undated' },
  ] : [
    { label: 'Available cases', value: workload?.assigned_cases, detail: 'Case records available to your role' },
    { label: 'Open cases', value: workload?.pending_case_work, detail: 'Pending, ongoing or active cases' },
    { label: 'Cases dated today', value: workload?.cases_created_today, detail: 'Available cases with today’s form date' },
    { label: 'Documents scanned', value: workload?.my_ocr_usage, detail: 'Your recorded OCR usage' },
  ];

  return <MainLayout><div className="dashboard-workspace mx-auto max-w-[1440px] space-y-6">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
      <div><h1 className="text-3xl font-bold tracking-tight text-[#172534]">Dashboard</h1><p className="mt-2 text-sm text-[#526174]">{admin ? 'Office workload and records requiring attention.' : 'Available case work and your intake tasks.'} <span className="whitespace-nowrap">{dashboardDate(new Date().toISOString())}</span></p></div>
      <Link to="/cases?action=intake" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#704389] px-5 py-3 font-semibold text-white hover:bg-[#5F3675]"><FileScan size={20} aria-hidden="true" />Scan interview sheet</Link>
    </header>
    <nav aria-label="Common dashboard tasks" className="flex flex-wrap gap-3">
      <Link to="/cases" className={button}><Search size={18} aria-hidden="true" />Find client or case</Link>
      <Link to="/cases?action=client" className={button}>Add client manually</Link>
      <Link to="/cases?action=case" className={button}>Add criminal case</Link>
      <Link to={admin ? '/case-review-center' : '/case-submissions'} className={button}>{admin ? 'Review staff reports' : 'Manage my reports'}</Link>
    </nav>
    {errors.length > 0 && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E4B875] bg-[#FFFBEB] p-4 text-sm text-[#78350F]"><p>{errors.join(', ')} could not be loaded. Unavailable values are shown as —.</p><button type="button" className={button} onClick={() => setRevision(v => v+1)}>Retry dashboard data</button></div>}
    <section aria-label="Workload summary" aria-busy={loading} className="rounded-xl border border-[#DDE3EA] bg-white">
      <dl className="grid grid-cols-2 divide-x divide-[#E5E7EB] lg:grid-cols-4">{metrics.map(metric => <div key={metric.label} className="min-w-0 p-4 sm:p-5"><dt className="text-sm font-semibold text-[#526174]">{metric.label}</dt><dd className="mt-2 text-3xl font-semibold tabular-nums text-[#172534]">{loading ? <SkeletonBlock className="h-9 w-16" /> : metric.value ?? '—'}</dd><p className="mt-2 text-sm leading-5 text-[#526174]">{metric.detail}</p></div>)}</dl>
    </section>
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-w-0 space-y-6">
        <Panel title="Needs attention" action={<Link className="dashboard-text-link" to={admin ? '/case-review-center' : '/case-submissions'}>{admin ? 'Review reports' : 'Open my reports'}<ArrowRight size={16} aria-hidden="true" /></Link>}>
          {loading ? <SkeletonBlock className="h-24" /> : submissions === null ? <p className="text-sm text-[#526174]">Report queue unavailable. Retry dashboard data above.</p> : <>
            <p className="mb-4 text-sm text-[#526174]">{pending.length} {admin ? 'staff reports awaiting review' : 'reports returned for correction'}.</p>
            {pending.length === 0 ? <p className="rounded-lg bg-[#F8FAFC] p-4 text-sm text-[#526174]">{admin ? 'No staff reports are waiting for your review.' : 'No reports have been returned for correction.'}</p> : <ul className="divide-y divide-[#E5E7EB]">{pending.slice(0,4).map(s => <li key={s.submission_id}><Link to={`${admin ? '/case-review-center' : '/case-submissions'}?submission=${encodeURIComponent(s.submission_id)}`} className="flex min-h-16 items-center justify-between gap-3 py-3 hover:text-[#704389]"><div className="min-w-0"><p className="break-words font-semibold">{s.title}</p><p className="mt-1 text-sm text-[#526174]">{admin ? `${s.staff_name} · ` : ''}{dashboardDate(s.updated_at)} · {s.status}</p></div><ArrowRight size={18} className="shrink-0" aria-hidden="true" /></Link></li>)}</ul>}
          </>}
          {!admin && workload && workload.pending_case_work > 0 && <Link to="/cases" className="dashboard-text-link mt-4">Find open cases for follow-up<ArrowRight size={16} aria-hidden="true" /></Link>}
          <div className="mt-5 border-t border-[#E5E7EB] pt-4"><h3 className="font-semibold">Review a scanned interview</h3><p className="mt-1 text-sm leading-6 text-[#526174]">Review Parts II and II-A beside the original scan, correct the entries, then save.</p><Link to="/cases?action=intake" className="dashboard-text-link mt-2">Open scan and OCR review<ArrowRight size={16} aria-hidden="true" /></Link></div>
        </Panel>
        <Panel title="Recent activity">
          {loading ? <SkeletonBlock className="h-24" /> : errors.includes('Recent activity') || (!admin && !workload) ? <p className="text-sm text-[#526174]">Activity is unavailable. Retry dashboard data above.</p> : recent.length === 0 ? <div><p className="text-sm leading-6 text-[#526174]">No recent activity recorded. Start with a client intake or find an existing record.</p><Link to="/cases" className="dashboard-text-link mt-3">Open client and case records<ArrowRight size={16} aria-hidden="true" /></Link></div> : <ul className="divide-y divide-[#E5E7EB]">{recent.map(item => <li key={item.id} className="py-3 first:pt-0"><p className="break-words text-sm leading-6">{item.description}</p><p className="mt-1 text-xs text-[#526174]">{dashboardDate(item.timestamp)}</p></li>)}</ul>}
        </Panel>
      </div>
      <div className="min-w-0 space-y-6">
        {admin ? <AdminReminders /> : <Panel title="Recent cases" action={<Link to="/cases" className="dashboard-text-link">Find a record<ArrowRight size={16} aria-hidden="true" /></Link>}>
          {loading ? <SkeletonBlock className="h-24" /> : !workload ? <p className="text-sm text-[#526174]">Recent cases unavailable.</p> : workload.recent_cases.length === 0 ? <p className="text-sm leading-6 text-[#526174]">No recent cases. Existing client profiles can still be found in client and case records.</p> : <ul className="divide-y divide-[#E5E7EB]">{workload.recent_cases.slice(0,5).map(record => <li key={record.case_id}><Link className="block py-3" to={`/cases?case=${encodeURIComponent(record.case_id)}`}><p className="break-words font-semibold">{record.intake_record.control_no || 'Control number not recorded'}</p><p className="mt-1 text-sm text-[#526174]">{record.cases.status_of_case} · {dashboardDate(record.last_updated)}</p></Link></li>)}</ul>}
        </Panel>}
        {!admin && workload && workload.recent_clients.length > 0 && <Panel title="Clients in recent cases"><ul className="divide-y divide-[#E5E7EB]">{workload.recent_clients.slice(0,5).map(client => <li key={client.client_id}><Link to={`/cases?client=${encodeURIComponent(client.client_id)}`} className="block break-words py-3 font-semibold hover:text-[#704389]">{client.client.name || 'Name not recorded'}</Link></li>)}</ul></Panel>}
        {admin && <Link to="/analytics" className="flex items-center justify-between gap-3 rounded-xl border border-[#DDE3EA] bg-white p-5 hover:border-[#704389]"><div><h2 className="font-semibold">Explore analytics</h2><p className="mt-1 text-sm leading-6 text-[#526174]">Case trends, categories and client address distribution.</p></div><ArrowRight size={20} className="shrink-0" aria-hidden="true" /></Link>}
      </div>
    </div>
    <div className="flex items-center gap-2 text-xs text-[#526174]"><RefreshCw size={14} aria-hidden="true" /><button className="min-h-11 underline underline-offset-4" type="button" disabled={loading} onClick={() => setRevision(v=>v+1)}>{loading ? 'Loading dashboard data…' : 'Refresh dashboard data'}</button><span>· {admin ? 'Office-wide summary' : 'Your workload'}</span></div>
  </div></MainLayout>;
}
