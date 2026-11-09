import { Camera, FileScan, Keyboard, Upload } from "lucide-react";
import ModalPortal from "../../../components/modals/ModalPortal";
import type { CaseType } from "../../../types";

export function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
      <path fill="currentColor" d="M9 3h2v6h6v2h-6v6H9v-6H3V9h6V3Z" />
    </svg>
  );
}

export function UserPlusIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
      <path
        fill="currentColor"
        d="M8 10a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0 2c3.3 0 6 1.6 6 3.5V17H2v-1.5C2 13.6 4.7 12 8 12Zm7-6h2v3h3v2h-3v3h-2v-3h-3V9h3V6Z"
      />
    </svg>
  );
}

export function EyeIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
      <path
        fill="currentColor"
        d="M10 4C5.8 4 2.7 7.1 1.5 10c1.2 2.9 4.3 6 8.5 6s7.3-3.1 8.5-6C17.3 7.1 14.2 4 10 4Zm0 10a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0-2.1a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8Z"
      />
    </svg>
  );
}

export function ManualInputSelectionModal({
  caseType,
  onClose,
  onSelectCase,
  onSelectClient,
}: {
  caseType: CaseType;
  onClose: () => void;
  onSelectCase: () => void;
  onSelectClient: () => void;
}) {
  return (
    <ModalPortal>
      <div
        className="jurisguard-modal-overlay bg-black/70 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-input-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <div className="jurisguard-modal-surface w-full max-w-xl overflow-hidden rounded-2xl border border-[#CBD5E1] bg-white shadow-xl">
          <header className="flex items-center justify-between gap-4 border-b border-[#5F3675] bg-[#704389] px-5 py-4 text-white">
            <div className="flex items-center gap-3">
              <Keyboard className="h-5 w-5 shrink-0" aria-hidden="true" />
              <div>
                <h2 id="manual-input-title" className="text-lg font-bold">
                  Manual Input
                </h2>
                <p className="mt-1 text-sm text-white/85">
                  Select what you want to add.
                </p>
              </div>
            </div>
          </header>
          <div className="space-y-3 p-5">
            <button
              type="button"
              onClick={onSelectCase}
              className="flex min-h-20 w-full items-center gap-4 rounded-xl border border-[#704389] bg-[#FAF7FC] p-4 text-left transition hover:bg-[#F2E9F7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389]"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-[#704389] shadow-sm">
                <PlusIcon />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-[#2B3642]">
                  Add {caseType} Case
                </span>
                <span className="mt-1 block text-sm leading-5 text-[#6B7280]">
                  Manually enter a new {caseType.toLowerCase()} case and its
                  associated client information.
                </span>
              </span>
              <span aria-hidden="true" className="text-lg text-[#704389]">
                ›
              </span>
            </button>
            <button
              type="button"
              onClick={onSelectClient}
              className="flex min-h-20 w-full items-center gap-4 rounded-xl border border-[#D1D5DB] bg-white p-4 text-left transition hover:bg-[#F8FAFC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389]"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#ECFDF5] text-[#15803D] shadow-sm">
                <UserPlusIcon />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-[#2B3642]">
                  Add Client
                </span>
                <span className="mt-1 block text-sm leading-5 text-[#6B7280]">
                  Create a new client record manually.
                </span>
              </span>
              <span aria-hidden="true" className="text-lg text-[#704389]">
                ›
              </span>
            </button>
          </div>
          <footer className="flex justify-end border-t border-[#E5E7EB] bg-[#F8FAFC] px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[#D1D5DB] bg-white px-4 py-2 text-sm font-semibold text-[#4B5563] transition hover:bg-[#F3F4F6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389]"
            >
              Cancel
            </button>
          </footer>
        </div>
      </div>
    </ModalPortal>
  );
}

export function UploadScanSelectionModal({
  onClose,
  onSelectScan,
  onSelectUpload,
}: {
  onClose: () => void;
  onSelectScan: () => void;
  onSelectUpload: () => void;
}) {
  return (
    <ModalPortal>
      <div
        className="jurisguard-modal-overlay bg-black/70 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-scan-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <div className="jurisguard-modal-surface w-full max-w-xl overflow-hidden rounded-2xl border border-[#CBD5E1] bg-white shadow-xl">
          <header className="flex items-center justify-between gap-4 border-b border-[#5F3675] bg-[#704389] px-5 py-4 text-white">
            <div className="flex items-center gap-3">
              <FileScan className="h-5 w-5 shrink-0" aria-hidden="true" />
              <div>
                <h2 id="upload-scan-title" className="text-lg font-bold">
                  Upload / Scan Input
                </h2>
                <p className="mt-1 text-sm text-white/85">
                  Scan or upload the whole paper document.
                </p>
              </div>
            </div>
          </header>
          <div className="space-y-3 p-5">
            <button
              type="button"
              onClick={onSelectScan}
              className="flex min-h-20 w-full items-center gap-4 rounded-xl border border-[#704389] bg-[#FAF7FC] p-4 text-left transition hover:bg-[#F2E9F7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389]"
            >
              <Camera
                className="ml-1 h-6 w-6 shrink-0 text-[#704389]"
                aria-hidden="true"
              />
              <span className="flex-1">
                <span className="block font-semibold text-[#2B3642]">Scan</span>
                <span className="mt-1 block text-sm text-[#6B7280]">
                  Open the camera-only scanning workflow.
                </span>
              </span>
              <span aria-hidden="true" className="text-lg text-[#704389]">
                ›
              </span>
            </button>
            <button
              type="button"
              onClick={onSelectUpload}
              className="flex min-h-20 w-full items-center gap-4 rounded-xl border border-[#D1D5DB] bg-white p-4 text-left transition hover:border-[#704389] hover:bg-[#F8FAFC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389]"
            >
              <Upload
                className="ml-1 h-6 w-6 shrink-0 text-[#704389]"
                aria-hidden="true"
              />
              <span className="flex-1">
                <span className="block font-semibold text-[#2B3642]">
                  Upload
                </span>
                <span className="mt-1 block text-sm text-[#6B7280]">
                  Open the file-upload-only workflow.
                </span>
              </span>
              <span aria-hidden="true" className="text-lg text-[#704389]">
                ›
              </span>
            </button>
          </div>
          <footer className="flex justify-end border-t border-[#E5E7EB] bg-[#F8FAFC] px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[#D1D5DB] bg-white px-4 py-2 text-sm font-semibold text-[#4B5563] transition hover:bg-[#F3F4F6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389]"
            >
              Cancel
            </button>
          </footer>
        </div>
      </div>
    </ModalPortal>
  );
}
