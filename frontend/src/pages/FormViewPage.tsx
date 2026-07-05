import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Link, useParams, useSearchParams } from "react-router-dom";
import MainLayout from "../layouts/MainLayout";
import PrintableFormEnglish from "../components/printable/PrintableFormEnglish";
import PrintableFormFilipino from "../components/printable/PrintableFormFilipino";
import { getPrintableIntake, type PrintableIntakeResponse } from "../services/recordService";
import {
  hydrateOfficialTemplate,
  type PrintableFormLanguage,
} from "../components/printable/officialFormHydrator";

export default function FormViewPage() {
  const { caseId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const printRootRef = useRef<HTMLDivElement>(null);
  const [language, setLanguage] = useState<PrintableFormLanguage>(() => {
    const requestedLanguage = searchParams.get("language");
    return requestedLanguage === "english" || requestedLanguage === "filipino"
      ? requestedLanguage
      : "english";
  });
  const [data, setData] = useState<PrintableIntakeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const autoPrint = searchParams.get("autoPrint") === "1";
  const autoPrintDoneRef = useRef(false);

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

  const printableData = useMemo(() => {
    if (!data) return null;
    return {
      client: data.client,
      selectedCase: data.selected_case,
      cases: data.cases,
    };
  }, [data]);

  const activeTemplate = data
    ? language === "english"
      ? data.templates.english
      : data.templates.filipino
    : "";

  const printMarkup = useMemo(() => {
    if (!printableData || !activeTemplate) return "";
    const hydrated = hydrateOfficialTemplate(activeTemplate, printableData, language);
    const doc = new DOMParser().parseFromString(hydrated, "text/html");
    const styles = Array.from(doc.head.querySelectorAll("style"))
      .map((style) => style.outerHTML)
      .join("\n");
    return `${styles}\n${doc.body.innerHTML}`;
  }, [activeTemplate, language, printableData]);

  const waitForPrintAssets = useCallback(async () => {
    const printRoot = printRootRef.current;
    if (!printRoot) return;

    const pendingImages = Array.from(printRoot.querySelectorAll("img")).filter(
      (image) => !image.complete,
    );

    if (pendingImages.length === 0) return;

    await Promise.race([
      Promise.all(
        pendingImages.map(
          (image) =>
            new Promise<void>((resolve) => {
              image.addEventListener("load", () => resolve(), { once: true });
              image.addEventListener("error", () => resolve(), { once: true });
            }),
        ),
      ),
      new Promise<void>((resolve) => window.setTimeout(resolve, 1000)),
    ]);
  }, []);

  const printPreview = useCallback(async () => {
    if (!printMarkup) {
      toast.error("Printable form is still loading. Please try again.");
      return;
    }

    await waitForPrintAssets();
    window.print();
  }, [printMarkup, waitForPrintAssets]);

  useEffect(() => {
    autoPrintDoneRef.current = false;
  }, [autoPrint, caseId]);

  useEffect(() => {
    if (!autoPrint || !printMarkup || autoPrintDoneRef.current) return;
    autoPrintDoneRef.current = true;
    const timeout = window.setTimeout(() => {
      void printPreview();
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [autoPrint, printMarkup, printPreview]);

  return (
    <>
      <MainLayout>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-brand-600 dark:text-brand-400">Official PAO Intake Form</p>
          <h1 className="text-2xl font-bold text-ink">
            {data?.client.client.name ?? "Printable Form"}
          </h1>
          <p className="mt-1 text-sm text-muted">
            Case: {data?.selected_case.intake_record.control_no ?? caseId}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex rounded-lg border border-line bg-card p-1">
            <button
              type="button"
              onClick={() => setLanguage("english")}
              className={`rounded px-3 py-1.5 text-sm font-semibold ${
                language === "english" ? "bg-brand-600 text-white" : "text-muted"
              }`}
            >
              English
            </button>
            <button
              type="button"
              onClick={() => setLanguage("filipino")}
              className={`rounded px-3 py-1.5 text-sm font-semibold ${
                language === "filipino" ? "bg-brand-600 text-white" : "text-muted"
              }`}
            >
              Filipino
            </button>
          </div>
          <button
            type="button"
            onClick={printPreview}
            disabled={!data || !printMarkup}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
          >
            {printMarkup ? "Print Form" : "Preparing Form..."}
          </button>
          <Link
            to="/criminal-cases"
            className="rounded-lg border border-line bg-card px-4 py-2 text-sm font-semibold text-muted hover:bg-card-2"
          >
            Back to Cases
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="h-[720px] animate-pulse rounded-lg bg-line" />
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
        <div className="rounded-lg border border-red-200 dark:border-red-400/25 bg-red-50 dark:bg-red-400/10 px-4 py-3 text-sm font-semibold text-red-700 dark:text-red-300">
          Printable form data could not be loaded.
        </div>
      )}
      </MainLayout>
      <div
        ref={printRootRef}
        className="jurisguard-print-root"
        dangerouslySetInnerHTML={{ __html: printMarkup }}
      />
    </>
  );
}

