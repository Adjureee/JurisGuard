import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import toast from "react-hot-toast";
import { createAuditLog } from "../services/auditService";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ErrorBoundary from "../components/ErrorBoundary";
import {
  AnalyticsPanel,
  EmptyState,
  SkeletonBlock,
} from "../components/dashboard/AnalyticsPrimitives";
import ReportExportModal, { type ReportExportRow } from "../components/modals/ReportExportModal";
import MainLayout from "../layouts/MainLayout";
import PageHeader from "../components/PageHeader";
import { formatLegalMonth } from "../services/dashboardService";
import { useDashboardAnalytics } from "./dashboard/useDashboardAnalytics";

const GeoAnalyticsMap = lazy(() => import("../components/dashboard/GeoAnalyticsMap"));

type DatePreset = "all" | "last7" | "last30" | "month" | "year" | "custom";

const datePresetLabels: Record<Exclude<DatePreset, "custom">, string> = {
  all: "All dates",
  last7: "Last 7 Days",
  last30: "Last 30 Days",
  month: "This Month",
  year: "This Year",
};

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatExportDate(value: string) {
  if (!value) return "Not specified";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
}

function presetRange(preset: DatePreset) {
  if (preset === 'all') return { dateFrom: '', dateTo: '' };
  const now = new Date();
  const start = new Date(now);
  if (preset === "last7") start.setDate(now.getDate() - 6);
  if (preset === "last30") start.setDate(now.getDate() - 29);
  if (preset === "month") start.setDate(1);
  if (preset === "year") {
    start.setMonth(0);
    start.setDate(1);
  }
  return { dateFrom: isoDate(start), dateTo: isoDate(now) };
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm shadow-xl ">
      <p className="font-semibold text-[#2B3642]">{label}</p>
      {payload.map((item) => (
        <p key={item.name ?? "value"} className="text-[#4B5563]">
          {item.name ?? "Cases"}: <span className="font-semibold">{item.value}</span>
        </p>
      ))}
    </div>
  );
}

interface ChartExportContext {
  title: string;
  description: string;
  coveragePeriod: string;
  filtersApplied: string;
  legend?: Array<{
    label: string;
    value: number;
    percentage: number;
    color: string;
  }>;
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  });
  if (line) lines.push(line);
  lines.forEach((lineText, index) => context.fillText(lineText, x, y + index * lineHeight));
  return lines.length;
}

async function downloadChartPng(
  container: HTMLElement | null,
  filename: string,
  exportContext: ChartExportContext,
) {
  const svg = container?.querySelector("svg");
  if (!svg) {
    window.alert("No chart is available to download yet.");
    return;
  }

  const bounds = svg.getBoundingClientRect();
  const chartWidth = Math.max(Math.ceil(bounds.width), 1);
  const chartHeight = Math.max(Math.ceil(bounds.height), 1);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(chartWidth));
  clone.setAttribute("height", String(chartHeight));

  const svgText = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  await new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const scale = 2;
      const horizontalPadding = 48;
      const headerHeight = 218;
      const footerHeight = 58;
      const canvasWidth = Math.max(chartWidth, 640);
      const legendColumns = canvasWidth >= 760 ? 2 : 1;
      const legendRows = exportContext.legend
        ? Math.ceil(exportContext.legend.length / legendColumns)
        : 0;
      const legendHeight = exportContext.legend?.length
        ? legendRows * 38 + 20
        : 0;
      const canvasHeight = headerHeight + chartHeight + legendHeight + footerHeight;
      const canvas = document.createElement("canvas");
      canvas.width = canvasWidth * scale;
      canvas.height = canvasHeight * scale;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Canvas is not available."));
        return;
      }
      context.scale(scale, scale);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvasWidth, canvasHeight);

      context.fillStyle = "#704389";
      context.font = "700 13px Arial, sans-serif";
      context.fillText("JURISGUARD", horizontalPadding, 34);
      context.fillStyle = "#6B7280";
      context.font = "600 12px Arial, sans-serif";
      context.fillText("PAO PANABO", horizontalPadding + 98, 34);

      context.fillStyle = "#111827";
      context.font = "700 25px Arial, sans-serif";
      const titleLines = drawWrappedText(
        context,
        exportContext.title.toUpperCase(),
        horizontalPadding,
        78,
        canvasWidth - horizontalPadding * 2,
        31,
      );
      context.fillStyle = "#4B5563";
      context.font = "400 13px Arial, sans-serif";
      const descriptionY = 98 + titleLines * 31;
      const descriptionLines = drawWrappedText(
        context,
        exportContext.description,
        horizontalPadding,
        descriptionY,
        canvasWidth - horizontalPadding * 2,
        20,
      );
      const metadataY = descriptionY + descriptionLines * 20 + 27;
      context.fillStyle = "#374151";
      context.font = "600 12px Arial, sans-serif";
      context.fillText(`Coverage Period: ${exportContext.coveragePeriod}`, horizontalPadding, metadataY);
      context.fillText(`Filters Applied: ${exportContext.filtersApplied}`, horizontalPadding, metadataY + 20);
      context.strokeStyle = "#E5E7EB";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(horizontalPadding, headerHeight - 18);
      context.lineTo(canvasWidth - horizontalPadding, headerHeight - 18);
      context.stroke();

      const chartX = Math.max((canvasWidth - chartWidth) / 2, 0);
      context.drawImage(image, chartX, headerHeight, chartWidth, chartHeight);

      if (exportContext.legend?.length) {
        const legendTop = headerHeight + chartHeight + 16;
        const columnWidth = (canvasWidth - horizontalPadding * 2) / legendColumns;
        context.font = "600 11px Arial, sans-serif";
        exportContext.legend.forEach((item, index) => {
          const column = index % legendColumns;
          const row = Math.floor(index / legendColumns);
          const itemX = horizontalPadding + column * columnWidth;
          const itemY = legendTop + row * 38;
          context.fillStyle = item.color;
          context.fillRect(itemX, itemY - 9, 10, 10);
          context.fillStyle = "#374151";
          drawWrappedText(
            context,
            `${item.label} - ${item.value} (${item.percentage}%)`,
            itemX + 17,
            itemY,
            columnWidth - 22,
            15,
          );
        });
      }

      context.fillStyle = "#6B7280";
      context.font = "400 11px Arial, sans-serif";
      context.fillText("Generated from JurisGuard Analytics", horizontalPadding, canvasHeight - 22);
      context.textAlign = "right";
      context.fillText(`Generated on: ${new Date().toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })}`, canvasWidth - horizontalPadding, canvasHeight - 22);
      context.textAlign = "left";
      URL.revokeObjectURL(url);
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = filename;
      link.click();
      resolve();
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to render chart image."));
    };
    image.src = url;
  });
}


function ChartDownloadButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[#D1D5DB] bg-white px-3 text-xs font-semibold text-[#4B5563] transition hover:border-[#704389] hover:text-[#704389] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#704389]"
    >
      <Download className="h-4 w-4" />
      {label}
    </button>
  );
}

export default function AnalyticsPage() {
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [dateRange, setDateRange] = useState(() => presetRange("all"));
  const [dateInputs, setDateInputs] = useState(dateRange);
  const invalidRange = datePreset !== 'all' && (!dateInputs.dateFrom || !dateInputs.dateTo || dateInputs.dateFrom > dateInputs.dateTo);
  const {
    barangays,
    caseCategories,
    heatmap,
    intakeLoad,
    isLoading,
    error,
    retry,
    monthlyTrends,
    ocrAnalytics,
    overview,
    terminatedStats,
  } = useDashboardAnalytics({ dateRange });
  const [selectedBarangay, setSelectedBarangay] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const monthlyChartRef = useRef<HTMLDivElement>(null);
  const weeklyChartRef = useRef<HTMLDivElement>(null);
  const categoryChartRef = useRef<HTMLDivElement>(null);
  const terminatedChartRef = useRef<HTMLDivElement>(null);

  const intakeTotal = useMemo(() => monthlyTrends.reduce((sum, row) => sum + row.total_cases, 0), [monthlyTrends]);
  const displayMonthlyTrends = useMemo(
    () => monthlyTrends.map((row) => ({ ...row, month: formatLegalMonth(row.month) })),
    [monthlyTrends]
  );
  const displayTerminatedMonthly = useMemo(
    () => (terminatedStats?.monthly ?? []).map((row) => ({ ...row, month: formatLegalMonth(row.month) })),
    [terminatedStats]
  );
  const intakePeak = useMemo(
    () => displayMonthlyTrends.reduce<typeof displayMonthlyTrends[number] | null>((best, row) => (!best || row.total_cases > best.total_cases ? row : best), null),
    [displayMonthlyTrends]
  );
  const topBarangays = useMemo(() => barangays, [barangays]);
  const activeBarangay = topBarangays.some((row) => row.barangay === selectedBarangay) ? selectedBarangay : null;
  const categoryPie = useMemo(() => caseCategories, [caseCategories]);
  const categoryTotal = caseCategories.reduce((sum, row) => sum + row.total_cases, 0);
  const categoryLegendItems = useMemo(
    () =>
      categoryPie.map((row) => ({
        label: row.category,
        value: row.total_cases,
        percentage: categoryTotal
          ? Math.round((row.total_cases / categoryTotal) * 100)
          : 0,
        color: "#704389",
      })),
    [categoryPie, categoryTotal],
  );
  const hourlyRows = useMemo(
    () => (intakeLoad?.hourly ?? []).filter((row) => Number.isFinite(row.total_cases) && row.total_cases > 0),
    [intakeLoad]
  );
  const terminationReasons = useMemo(() => terminatedStats?.by_reason ?? [], [terminatedStats]);
  const exportRows = useMemo<ReportExportRow[]>(() => {
    const monthlyRows = monthlyTrends.map((row) => ({
      dataset: "monthly_intake_trends",
      case_category: "Monthly Case Trends",
      date: formatLegalMonth(row.month),
      label: formatLegalMonth(row.month),
      value: row.total_cases,
      case_status: "All",
      barangay: "",
      staff: "",
      ocr_status: "",
      termination_status: "",
      secondary_label: "",
      secondary_value: "",
    }));
    const weeklyRows = (intakeLoad?.weekly ?? []).map((row) => ({
      dataset: "weekly_volume_distribution",
      case_category: "Peak Operational Days",
      date: "",
      label: row.day,
      value: row.total_cases,
      case_status: "All",
      barangay: "",
      staff: "",
      ocr_status: "",
      termination_status: "",
      secondary_label: "",
      secondary_value: "",
    }));
    const hourlyRows = (intakeLoad?.hourly ?? []).map((row) => ({
      dataset: "hourly_intake_heat",
      case_category: "Peak Operational Hours",
      date: "",
      label: row.hour,
      value: row.total_cases,
      case_status: "All",
      barangay: "",
      staff: "",
      ocr_status: "",
      termination_status: "",
      secondary_label: "",
      secondary_value: "",
    }));
    const categoryRows = caseCategories.map((row) => ({
      dataset: "case_category_analytics",
      case_category: row.category,
      date: "",
      label: row.category,
      value: row.total_cases,
      case_status: "All",
      barangay: "",
      staff: "",
      ocr_status: "",
      termination_status: "",
      secondary_label: "",
      secondary_value: "",
    }));
    const barangayRows = barangays.map((row) => ({
      dataset: "barangay_hotspots",
      case_category: row.most_common_category,
      date: "",
      label: row.barangay,
      value: row.total_cases,
      case_status: "",
      barangay: row.barangay,
      staff: "",
      ocr_status: "",
      termination_status: "",
      secondary_label: row.most_common_category,
      secondary_value: "",
    }));
    const terminatedRows = (terminatedStats?.monthly ?? []).map((row) => ({
      dataset: "terminated_case_movement",
      case_category: "Termination Trends",
      date: formatLegalMonth(row.month),
      label: formatLegalMonth(row.month),
      value: row.total_cases,
      case_status: "Terminated",
      barangay: "",
      staff: "",
      ocr_status: "",
      termination_status: "Terminated",
      secondary_label: "",
      secondary_value: "",
    }));
    const ocrRows = (ocrAnalytics?.trends ?? []).map((row) => ({
      dataset: "ocr_volume_trends",
      case_category: "OCR Volume Trends",
      date: formatLegalMonth(row.month),
      label: formatLegalMonth(row.month),
      value: row.total_scans,
      case_status: "",
      barangay: "",
      staff: "",
      ocr_status: "All",
      termination_status: "",
      secondary_label: "",
      secondary_value: "",
    }));
    return [...monthlyRows, ...weeklyRows, ...hourlyRows, ...categoryRows, ...barangayRows, ...terminatedRows, ...ocrRows];
  }, [barangays, caseCategories, intakeLoad, monthlyTrends, ocrAnalytics, terminatedStats]);

  const applyPreset = (preset: DatePreset) => {
    setSelectedBarangay(null);
    setDatePreset(preset);
    if (preset !== "custom") {
      const range = presetRange(preset);
      setDateRange(range);
      setDateInputs(range);
    }
  };
  const changeDate = (field: "dateFrom" | "dateTo", value: string) => {
    setDatePreset("custom");
    const range = { ...dateInputs, [field]: value };
    setDateInputs(range);
    if (range.dateFrom && range.dateTo && range.dateFrom <= range.dateTo) setDateRange(range);
  };
  const period = datePreset === 'all' ? 'All dates' : `${formatExportDate(dateRange.dateFrom)} – ${formatExportDate(dateRange.dateTo)}`;
  const download = (ref: HTMLDivElement | null, title: string, legend?: ChartExportContext["legend"]) =>
    void createAuditLog({ action: "Export PNG", module: "Export", entity_type: "analytics_chart_export" })
      .then(() => downloadChartPng(ref, `jurisguard-${title.toLowerCase().replaceAll(" ", "-")}.png`, {
      title, description: "Recorded data for the selected period.", coveragePeriod: period,
      filtersApplied: "Selected date range; permitted records only", legend,
      }))
      .catch(() => toast.error("Unable to record and export the chart. Please retry."));
  const statusRows = [
    { name: "Not terminated", count: overview?.range_active_cases ?? 0, color: "#B45309" },
    { name: "Terminated", count: overview?.range_terminated_cases ?? 0, color: "#B91C1C" },
  ];
  return (
    <MainLayout>
      <PageHeader eyebrow="" title="Analytics" description="Case activity, client locations, and recorded outcomes."
        actions={<button type="button" onClick={() => setExportOpen(true)} disabled={isLoading || invalidRange || Boolean(error) || exportRows.length === 0}
          className="min-h-11 rounded-md bg-[#704389] px-4 text-sm font-semibold text-white hover:bg-[#5F3675] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389] disabled:opacity-50">Export report</button>} />

      <section aria-label="Analytics filters" className="mb-6 rounded-xl border border-[#CBD5E1] bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Reporting period">
            {(["all", "last7", "last30", "month", "year"] as const).map((value) =>
              <button key={value} type="button" aria-pressed={datePreset === value} onClick={() => applyPreset(value)}
                className={`min-h-11 rounded-md border px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389] ${datePreset === value ? "border-[#704389] bg-[#F7F0FA] text-[#5F3675]" : "border-[#CBD5E1] text-[#4B5563] hover:bg-[#F8FAFC]"}`}>{datePresetLabels[value]}</button>)}
            <button type="button" aria-pressed={datePreset === "custom"} onClick={() => setDatePreset("custom")} className={`min-h-11 rounded-md border px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#704389] ${datePreset === "custom" ? "border-[#704389] bg-[#F7F0FA] text-[#5F3675]" : "border-[#CBD5E1] text-[#4B5563]"}`}>Custom range</button>
          </div>
          <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-2">
            <label className="text-sm font-medium">Start date<input type="date" aria-label="Start date" value={dateInputs.dateFrom} max={dateInputs.dateTo || undefined} onChange={(event) => changeDate("dateFrom", event.target.value)} className="mt-1 block min-h-11 w-full min-w-0 rounded-md border border-[#CBD5E1] px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#704389]" /></label>
            <label className="text-sm font-medium">End date<input type="date" aria-label="End date" value={dateInputs.dateTo} min={dateInputs.dateFrom || undefined} onChange={(event) => changeDate("dateTo", event.target.value)} className="mt-1 block min-h-11 w-full min-w-0 rounded-md border border-[#CBD5E1] px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#704389]" /></label>
          </div>
        </div>
        {invalidRange ? <p role="alert" className="mt-3 text-sm text-red-800">Start date and end date are required; start date must be on or before end date.</p>
          : <p className="mt-3 text-sm text-[#4B5563]" aria-live="polite">{period} · Cases by received date, clients by registration date, terminations by termination date.</p>}
      </section>

      {error && <div role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}<button type="button" onClick={retry} className="ml-3 min-h-11 rounded-md border border-red-300 bg-white px-4 font-semibold focus-visible:outline focus-visible:outline-2">Retry</button></div>}
      {isLoading ? <div role="status" aria-label="Loading analytics"><SkeletonBlock className="mb-6 h-28" /><SkeletonBlock className="h-80" /></div> : !invalidRange && !error ? <>
        <div className="grid items-start gap-6 xl:grid-cols-[1.3fr_1fr]">
          <AnalyticsPanel title="Cases received over time" subtitle="Recorded case volume by received date.">
            <div className="mb-3 flex justify-end"><ChartDownloadButton label="Download PNG" onClick={() => download(monthlyChartRef.current, "Cases received over time")} /></div>
            <div ref={monthlyChartRef} className="h-72">{intakeTotal === 0 ? <EmptyState message="No cases received in this period." /> :
              <ResponsiveContainer width="100%" height="100%"><LineChart data={displayMonthlyTrends} margin={{top:20,right:20,bottom:12,left:0}}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" /><XAxis dataKey="month" fontSize={12} minTickGap={30} /><YAxis allowDecimals={false} width={38} fontSize={12} /><Tooltip content={<ChartTooltip />} /><Line type="linear" dataKey="total_cases" name="Cases received" stroke="#704389" strokeWidth={3} dot={{r:4}} isAnimationActive={false} />
              </LineChart></ResponsiveContainer>}</div>
            <p className="mt-3 text-xs text-[#4B5563]">Purple line: cases received · {intakePeak ? `Highest recorded period: ${intakePeak.month} (${intakePeak.total_cases})` : "No recorded peak"}</p>
          </AnalyticsPanel>
          <AnalyticsPanel title="Case categories" subtitle="Composition of cases received in the selected period.">
            <div className="mb-3 flex justify-end"><ChartDownloadButton label="Download PNG" onClick={() => download(categoryChartRef.current, "Case categories", categoryLegendItems)} /></div>
            <div ref={categoryChartRef}>{categoryTotal === 0 ? <EmptyState message="No case categories recorded in this period." /> :
<div className="h-48"><ResponsiveContainer width="100%" height="100%"><BarChart data={caseCategories} margin={{top:20,right:10,bottom:10,left:0}}><XAxis dataKey="category" fontSize={11} tickFormatter={(value: string) => value.length > 18 ? `${value.slice(0, 17)}…` : value} /><YAxis allowDecimals={false} width={34} fontSize={12} /><Tooltip content={<ChartTooltip />} /><Bar dataKey="total_cases" name="Cases" fill="#704389" isAnimationActive={false} radius={[4,4,0,0]} /></BarChart></ResponsiveContainer></div>}
              <ul className="mt-3 space-y-2" aria-label="Case category counts">{caseCategories.map((row) => <li key={row.category} className="flex justify-between gap-4 text-sm"><span className="break-words text-[#2B3642]">{row.category}</span><span className="shrink-0 tabular-nums text-[#4B5563]">{row.total_cases} · {categoryTotal ? Math.round(row.total_cases / categoryTotal * 100) : 0}%</span></li>)}</ul>
            </div>
          </AnalyticsPanel>
        </div>

        <div className="mt-6 grid items-start gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <AnalyticsPanel title="Current case status" subtitle="Current status of the cases received in this period.">
            {intakeTotal === 0 ? <EmptyState message="No cases to classify in this period." /> : <ul className="space-y-5">{statusRows.map((row) => <li key={row.name}><div className="mb-2 flex justify-between text-sm"><span>{row.name}</span><strong className="tabular-nums">{row.count}</strong></div><div className="h-3 overflow-hidden rounded-full bg-[#EEF2F6]"><div className="h-full rounded-full" style={{width:`${intakeTotal ? row.count/intakeTotal*100 : 0}%`,backgroundColor:row.color}} /></div></li>)}</ul>}
          </AnalyticsPanel>
          <AnalyticsPanel title="Terminations over time" subtitle="Cases terminated during the period, regardless of when they were received.">
            <div className="mb-3 flex justify-end"><ChartDownloadButton label="Download PNG" onClick={() => download(terminatedChartRef.current, "Terminations over time")} /></div>
            <div ref={terminatedChartRef} className="h-56">{displayTerminatedMonthly.length === 0 ? <EmptyState message="No terminations recorded in this period." /> :
              <ResponsiveContainer width="100%" height="100%"><AreaChart data={displayTerminatedMonthly} margin={{top:15,right:15,bottom:10,left:0}}><CartesianGrid vertical={false} stroke="#E5E7EB" /><XAxis dataKey="month" fontSize={12} /><YAxis allowDecimals={false} width={35} fontSize={12} /><Tooltip content={<ChartTooltip />} /><Area type="linear" dataKey="total_cases" name="Terminated cases" stroke="#B91C1C" fill="#FEE2E2" isAnimationActive={false} /></AreaChart></ResponsiveContainer>}</div>
            <details className="mt-4 border-t border-[#E5E7EB] pt-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#704389]">Termination reasons</summary><ul className="mt-2 space-y-2">{terminationReasons.length ? terminationReasons.map((row) => <li key={row.reason} className="flex justify-between gap-3 text-sm"><span>{row.reason}</span><strong>{row.total_cases}</strong></li>) : <li className="text-sm text-[#4B5563]">No termination reasons recorded.</li>}</ul></details>
          </AnalyticsPanel>
        </div>

        <section className="mt-8" aria-labelledby="client-geography-title">
          <h2 id="client-geography-title" className="text-lg font-semibold">Where registered clients live</h2>
          <p className="mb-4 mt-1 text-sm text-[#4B5563]">Clients registered: {period}. Address selection changes map focus only; counts are unique clients, not crime incidents.</p>
          <div className="grid items-start gap-6 xl:grid-cols-[1.7fr_1fr]">
            <div className="min-w-0">{heatmap ? <ErrorBoundary fallback={<EmptyState message="The map could not render. Client address counts remain available." />}><Suspense fallback={<SkeletonBlock className="h-[520px]" />}><GeoAnalyticsMap center={heatmap.center} points={heatmap.points} barangays={heatmap.barangays} selectedBarangay={activeBarangay} onSelectBarangay={(value) => setSelectedBarangay(value || null)} /></Suspense></ErrorBoundary> : <EmptyState message="No client map data available." />}</div>
            <AnalyticsPanel title="Client address groups">
              <button type="button" aria-pressed={!activeBarangay} onClick={() => setSelectedBarangay(null)} className="mb-3 min-h-11 w-full rounded-md border border-[#CBD5E1] px-3 text-left text-sm font-semibold text-[#704389] focus-visible:outline focus-visible:outline-2">Show all client locations</button>
              {topBarangays.length === 0 ? <EmptyState message="No clients registered in this period." /> : <ul className="max-h-[32rem] space-y-2 overflow-y-auto">{topBarangays.map((row) => <li key={row.barangay}><button type="button" aria-pressed={activeBarangay===row.barangay} onClick={() => setSelectedBarangay(row.barangay)} className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-md border p-3 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#704389] ${activeBarangay===row.barangay ? "border-[#704389] bg-[#F7F0FA]" : "border-[#E5E7EB] hover:bg-[#F8FAFC]"}`}><span className="break-words">{row.barangay}</span><strong className="shrink-0 tabular-nums">{row.total_cases}</strong></button></li>)}</ul>}
            </AnalyticsPanel>
          </div>
        </section>

        <details className="mt-6 rounded-xl border border-[#CBD5E1] bg-white p-5">
          <summary className="min-h-11 cursor-pointer py-2 text-base font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#704389]">Intake patterns by weekday and hour</summary>
          <p className="mb-4 mt-1 text-sm text-[#4B5563]">Planning detail from recorded intake dates and times in this period.</p>
          <div className="grid gap-6 xl:grid-cols-2">
            <div><div className="mb-3 flex items-center justify-between gap-2"><h3 className="font-semibold">Cases by weekday</h3><ChartDownloadButton label="Download PNG" onClick={() => download(weeklyChartRef.current, "Cases by weekday")} /></div><div ref={weeklyChartRef} className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={intakeLoad?.weekly ?? []}><XAxis dataKey="day" tickFormatter={(day:string)=>day.slice(0,3)} fontSize={12} /><YAxis allowDecimals={false} width={35} fontSize={12} /><Tooltip content={<ChartTooltip />} /><Bar dataKey="total_cases" name="Cases received" fill="#704389" isAnimationActive={false} /></BarChart></ResponsiveContainer></div></div>
            <div><h3 className="mb-4 font-semibold">Cases by recorded hour</h3>{hourlyRows.length ? <ul className="space-y-3">{hourlyRows.map((row)=><li key={row.hour} className="flex justify-between text-sm"><span>{row.hour}</span><strong>{row.total_cases}</strong></li>)}</ul> : <EmptyState message="No recorded intake times in this period." />}</div>
          </div>
        </details>
      </> : null}
<ReportExportModal periodLocked isOpen={exportOpen} title="Analytics report export" description={`Report coverage: ${period}. Dates are set by the page; other export filters refine these datasets.`} fileName="jurisguard_analytics_report" rows={exportRows} scope="admin" redirectTo="/analytics" onClose={() => setExportOpen(false)} />
    </MainLayout>
  );
}
