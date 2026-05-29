import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Link, useParams, useSearchParams } from "react-router-dom";
import MainLayout from "../layouts/MainLayout";
import PrintableFormEnglish from "../components/printable/PrintableFormEnglish";
import PrintableFormFilipino from "../components/printable/PrintableFormFilipino";
import { getPrintableIntake, type PrintableIntakeResponse } from "../services/recordService";
import type { PrintableFormLanguage } from "../components/printable/officialFormHydrator";

export default function FormViewPage() {
  const { caseId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [language, setLanguage] = useState<PrintableFormLanguage>("english");
  const [data, setData] = useState<PrintableIntakeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadPrintableForm() {
      if (!caseId) return;
      setIsLoading(true);
      try {
        const response = await getPrintableIntake(caseId);
        if (!cancelled) setData(response);
      } catch (error) {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "Unable to load printable form");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void loadPrintableForm();
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  useEffect(() => {
    if (!data || searchParams.get("print") !== "1") return;
    const timeout = window.setTimeout(() => {
      frameRef.current?.contentWindow?.focus();
      frameRef.current?.contentWindow?.print();
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [data, language, searchParams]);

  const printableData = useMemo(() => {
    if (!data) return null;
    return {
      client: data.client,
      selectedCase: data.selected_case,
      cases: data.cases,
    };
  }, [data]);

  const printForm = () => {
    frameRef.current?.contentWindow?.focus();
    frameRef.current?.contentWindow?.print();
  };

  return (
    <MainLayout>
      <div className="mb-4 flex flex-col gap-3 print:hidden lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-[#704389]">Official PAO Intake Form</p>
          <h1 className="text-2xl font-bold text-[#2B3642]">
            {data?.client.client.name ?? "Printable Form"}
          </h1>
          <p className="mt-1 text-sm text-[#4B5563]">
            Case: {data?.selected_case.intake_record.control_no ?? caseId}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex rounded-md border border-[#E5E7EB] bg-white p-1">
            <button
              type="button"
              onClick={() => setLanguage("english")}
              className={`rounded px-3 py-1.5 text-sm font-semibold ${
                language === "english" ? "bg-[#704389] text-white" : "text-[#4B5563]"
              }`}
            >
              English
            </button>
            <button
              type="button"
              onClick={() => setLanguage("filipino")}
              className={`rounded px-3 py-1.5 text-sm font-semibold ${
                language === "filipino" ? "bg-[#704389] text-white" : "text-[#4B5563]"
              }`}
            >
              Filipino
            </button>
          </div>
          <button
            type="button"
            onClick={printForm}
            disabled={!data}
            className="rounded-md bg-[#704389] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#5F3675] disabled:opacity-50"
          >
            Print Form
          </button>
          <Link
            to="/criminal-cases"
            className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-semibold text-[#4B5563] hover:bg-[#F9FAFB]"
          >
            Back to Cases
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="h-[720px] animate-pulse rounded-lg bg-[#E5E7EB]" />
      ) : data && printableData ? (
        language === "english" ? (
          <PrintableFormEnglish
            ref={frameRef}
            template={data.templates.english}
            data={printableData}
          />
        ) : (
          <PrintableFormFilipino
            ref={frameRef}
            template={data.templates.filipino}
            data={printableData}
          />
        )
      ) : (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          Printable form data could not be loaded.
        </div>
      )}
    </MainLayout>
  );
}

