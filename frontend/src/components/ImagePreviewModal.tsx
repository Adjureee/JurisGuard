import { useEffect } from "react";

interface ImagePreviewModalProps {
  image: string | null;
  alt: string;
  title?: string;
  onClose: () => void;
}

export default function ImagePreviewModal({
  image,
  alt,
  title = "Image Preview",
  onClose,
}: ImagePreviewModalProps) {
  useEffect(() => {
    if (!image) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [image, onClose]);

  if (!image) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-4 py-6 backdrop-blur-sm"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="relative max-h-[92vh] w-full max-w-4xl animate-[modalIn_180ms_ease-out] overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-2xl shadow-gray-200/70"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-[#111827]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[#E5E7EB] bg-[#F3F4F6] text-lg font-semibold leading-none text-[#4B5563] transition hover:bg-[#E5E7EB] hover:text-[#111827]"
            aria-label="Close preview"
          >
            x
          </button>
        </div>
        <img
          src={image}
          alt={alt}
          className="max-h-[78vh] w-full rounded-xl bg-[#F3F4F6] object-contain"
        />
      </div>
    </div>
  );
}
