import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
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
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const pageOneFrameRef = useRef<HTMLIFrameElement>(null);
  const pageTwoFrameRef = useRef<HTMLIFrameElement>(null);
  const printRootRef = useRef<HTMLDivElement>(null);
  const [language, setLanguage] = useState<PrintableFormLanguage>(() => {
    const requestedLanguage = searchParams.get("language");
    return requestedLanguage === "english" || requestedLanguage === "filipino"
      ? requestedLanguage
      : "english";
  });
  const [data, setData] = useState<PrintableIntakeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const autoPrint = searchParams.get("autoPrint") === "1";
  const selectedClientId =
    searchParams.get("clientId") ?? searchParams.get("client_id") ?? "";
  const casesPath = location.pathname.startsWith("/civil-cases")
    ? "/civil-cases"
    : "/criminal-cases";
  const autoPrintDoneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function loadPrintableForm() {
      if (!caseId) return;
      setIsLoading(true);
      try {
        const response = await getPrintableIntake(caseId, selectedClientId);
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
  }, [caseId, selectedClientId]);

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

  const waitForFrameAssets = useCallback(async (frame: HTMLIFrameElement | null) => {
    const frameDocument = frame?.contentDocument;
    if (!frameDocument) return;

    await frameDocument.fonts?.ready;
    const pendingImages = Array.from(frameDocument.images).filter(
      (image) => !image.complete,
    );
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
      new Promise<void>((resolve) => window.setTimeout(resolve, 1500)),
    ]);
  }, []);

  const downloadPdf = useCallback(async () => {
    const frameDocuments = [
      pageOneFrameRef.current?.contentDocument,
      pageTwoFrameRef.current?.contentDocument,
    ];
    if (frameDocuments.some((document) => !document?.body) || !data) {
      toast.error("Interview Sheet is still loading. Please try again.");
      return;
    }

    setIsDownloading(true);
    try {
      const pageWidth = 8.5;
      const pageHeight = 13;
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "in",
        format: [pageWidth, pageHeight],
        compress: true,
      });
      for (const [pageIndex, frameDocument] of frameDocuments.entries()) {
        if (!frameDocument?.body) {
          throw new Error("The Interview Sheet page is still loading.");
        }
        await waitForFrameAssets(
          pageIndex === 0 ? pageOneFrameRef.current : pageTwoFrameRef.current,
        );
        const canvas = await html2canvas(frameDocument.body, {
          backgroundColor: "#ffffff",
          logging: false,
          scale: 2,
          useCORS: true,
          windowHeight: frameDocument.documentElement.scrollHeight,
          windowWidth: frameDocument.documentElement.scrollWidth,
        });
        if (!canvas.width || !canvas.height) {
          throw new Error("The Interview Sheet has no printable content.");
        }
        if (pageIndex > 0) pdf.addPage();
        const fitScale = Math.min(
          pageWidth / canvas.width,
          pageHeight / canvas.height,
        );
        const imageWidth = canvas.width * fitScale;
        const imageHeight = canvas.height * fitScale;
        pdf.addImage(
          canvas.toDataURL("image/png"),
          "PNG",
          (pageWidth - imageWidth) / 2,
          (pageHeight - imageHeight) / 2,
          imageWidth,
          imageHeight,
          undefined,
          "FAST",
        );
      }

      const sanitizeFilenamePart = (value: string) =>
        value
          .trim()
          .replace(/[^a-z0-9]+/gi, "-")
          .replace(/^-+|-+$/g, "") || "Unknown";
      const controlNumber = sanitizeFilenamePart(
        data.selected_case.intake_record.control_no || caseId,
      );
      const clientName = sanitizeFilenamePart(data.client.client.name);
      pdf.save(`Interview_Sheet_${controlNumber}_${clientName}.pdf`);
      toast.success("Interview Sheet PDF downloaded.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to download the Interview Sheet PDF.",
      );
    } finally {
      setIsDownloading(false);
    }
  }, [caseId, data, waitForFrameAssets]);

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
      <div className="mx-auto w-full max-w-[1440px]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Link
            to={casesPath}
            className="inline-flex items-center gap-2 text-sm font-semibold text-[#6B7280] transition hover:text-[#374151]"
          >
            <span aria-hidden="true" className="text-base">&larr;</span>
            Back to Cases
          </Link>
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[#9CA3AF]">
            {location.pathname.startsWith("/civil-cases") ? "Civil Cases" : "Criminal Cases"}
          </span>
        </div>

        <section className="mb-4 flex flex-col gap-4 border-b border-[#E5E7EB] pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#704389]">
              Interview Sheet
            </p>
            <h1 className="mt-1 truncate text-lg font-semibold text-[#111827] sm:text-xl">
              {data?.client.client.name ?? "Printable Form"}
            </h1>
            <p className="mt-1 text-sm text-[#6B7280]">
              Control No. {data?.selected_case.intake_record.control_no ?? caseId}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2" aria-label="Document actions">
            <div className="inline-flex rounded-md border border-[#D1D5DB] bg-white p-0.5" role="group" aria-label="Interview sheet language">
              <button
                type="button"
                onClick={() => setLanguage("english")}
                aria-pressed={language === "english"}
                className={`rounded px-3 py-1.5 text-sm font-semibold transition ${
                  language === "english"
                    ? "bg-[#F3EAF7] text-[#5F3675]"
                    : "text-[#6B7280] hover:bg-[#F9FAFB]"
                }`}
              >
                English
              </button>
              <button
                type="button"
                onClick={() => setLanguage("filipino")}
                aria-pressed={language === "filipino"}
                className={`rounded px-3 py-1.5 text-sm font-semibold transition ${
                  language === "filipino"
                    ? "bg-[#F3EAF7] text-[#5F3675]"
                    : "text-[#6B7280] hover:bg-[#F9FAFB]"
                }`}
              >
                Filipino
              </button>
            </div>
            <button
              type="button"
              onClick={downloadPdf}
              disabled={!data || !printMarkup || isDownloading}
              className="rounded-md border border-[#D1D5DB] bg-white px-3.5 py-2 text-sm font-semibold text-[#4B5563] shadow-sm transition hover:bg-[#F9FAFB] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isDownloading ? "Preparing PDF..." : "Download PDF"}
            </button>
            <button
              type="button"
              onClick={printPreview}
              disabled={!data || !printMarkup}
              className="inline-flex items-center gap-2 rounded-md border border-[#704389] bg-[#704389] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#5F3675] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {printMarkup ? "Print" : "Preparing..."}
            </button>
          </div>
        </section>

        <section className="min-w-0 bg-[#F3F4F6] px-2 py-4 sm:px-5 sm:py-6 lg:px-8" aria-label="Interview sheet workspace">
          <div className="mx-auto w-full max-w-[900px] space-y-8">
            {isLoading ? (
              [1, 2].map((page) => (
                <div key={page} className="space-y-2">
                  <p className="text-center text-xs font-bold uppercase tracking-[0.16em] text-[#9CA3AF] print:hidden">
                    Page {page}
                  </p>
                  <div className="aspect-[8.5/13] w-full animate-pulse bg-[#E5E7EB] shadow-[0_2px_12px_rgba(17,24,39,0.08)]" />
                </div>
              ))
            ) : data && printableData ? (
              [1, 2].map((page) => (
                <div key={page} className="space-y-2">
                  <p className="text-center text-xs font-bold uppercase tracking-[0.16em] text-[#6B7280] print:hidden">
                    Page {page}
                  </p>
                  <div className="w-full overflow-x-auto border border-[#D1D5DB] bg-white shadow-[0_2px_12px_rgba(17,24,39,0.08)]">
                    {language === "english" ? (
                      <PrintableFormEnglish
                        ref={page === 1 ? pageOneFrameRef : pageTwoFrameRef}
                        page={page as 1 | 2}
                        template={data.templates.english}
                        data={printableData}
                      />
                    ) : (
                      <PrintableFormFilipino
                        ref={page === 1 ? pageOneFrameRef : pageTwoFrameRef}
                        page={page as 1 | 2}
                        template={data.templates.filipino}
                        data={printableData}
                      />
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                Printable form data could not be loaded.
              </div>
            )}
          </div>
        </section>
      </div>
      </MainLayout>
      <div
        ref={printRootRef}
        className="jurisguard-print-root"
        dangerouslySetInnerHTML={{ __html: printMarkup }}
      />
    </>
  );
}

