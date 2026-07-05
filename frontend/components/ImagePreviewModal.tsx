import { useEffect } from "react";
import ModalPortal from "./modals/ModalPortal";

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
    <ModalPortal>
    <div
      className="jurisguard-modal-overlay bg-black/80 backdrop-blur-sm"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="jurisguard-modal-surface relative max-h-[92vh] w-full max-w-4xl animate-[modalIn_180ms_ease-out] overflow-hidden rounded-2xl border border-line bg-card p-4 shadow-xl "
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-800">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-parchment-100 text-lg font-semibold leading-none text-gray-600 transition hover:bg-gray-200 hover:text-gray-800"
            aria-label="Close preview"
          >
            x
          </button>
        </div>
        <img
          src={image}
          alt={alt}
          className="max-h-[78vh] w-full rounded-xl bg-parchment-100 object-contain"
        />
      </div>
    </div>
    </ModalPortal>
  );
}

