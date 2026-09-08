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
  page?: 1 | 2;
  onReady?: () => void;
}

const OfficialFormFrame = forwardRef<HTMLIFrameElement, OfficialFormFrameProps>(
  ({ template, data, language, page, onReady }, ref) => {
    const hydratedHtml = useMemo(
      () => hydrateOfficialTemplate(template, data, language),
      [data, language, template]
    );
    const viewerHtml = useMemo(() => {
      if (!page) return hydratedHtml;
      const pageStyles = `
        <style>
          .print-page:not(#page-${page}) { display: none !important; }
          .print-page#page-${page} { margin-bottom: 0 !important; box-shadow: none !important; }
        </style>
      `;
      return hydratedHtml.replace("</head>", `${pageStyles}</head>`);
    }, [hydratedHtml, page]);

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
        srcDoc={viewerHtml}
        onLoad={handleLoad}
        className="block aspect-[8.5/13] h-auto min-h-0 w-full rounded-none border-0 bg-white print:h-screen print:min-h-screen"
      />
    );
  }
);

OfficialFormFrame.displayName = "OfficialFormFrame";

export default OfficialFormFrame;

