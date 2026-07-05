import { forwardRef, useMemo, type SyntheticEvent } from "react";
import {
  hydrateOfficialTemplate,
  type PrintableFormData,
  type PrintableFormLanguage,
} from "./officialFormHydrator";

interface OfficialFormFrameProps {
  template: string;
  data: PrintableFormData;
  language: PrintableFormLanguage;
  onReady?: () => void;
}

const OfficialFormFrame = forwardRef<HTMLIFrameElement, OfficialFormFrameProps>(
  ({ template, data, language, onReady }, ref) => {
    const hydratedHtml = useMemo(
      () => hydrateOfficialTemplate(template, data, language),
      [data, language, template]
    );

    const handleLoad = async (event: SyntheticEvent<HTMLIFrameElement>) => {
      const frameDocument = event.currentTarget.contentDocument;
      const images = frameDocument ? Array.from(frameDocument.images) : [];
      await Promise.all(
        images.map((image) => {
          if (image.complete && image.naturalWidth > 0) return Promise.resolve();
          return new Promise<void>((resolve) => {
            image.addEventListener("load", () => resolve(), { once: true });
            image.addEventListener("error", () => resolve(), { once: true });
          });
        })
      );
      onReady?.();
    };

    return (
      <iframe
        ref={ref}
        title={`PAO intake form ${language}`}
        srcDoc={hydratedHtml}
        onLoad={handleLoad}
        className="h-[calc(100vh-190px)] min-h-[720px] w-full rounded-lg border border-[#D1D5DB] bg-white print:h-screen print:min-h-screen print:border-0"
      />
    );
  }
);

OfficialFormFrame.displayName = "OfficialFormFrame";

export default OfficialFormFrame;

