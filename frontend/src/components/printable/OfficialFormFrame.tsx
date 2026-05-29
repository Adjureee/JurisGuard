import { forwardRef, useMemo } from "react";
import {
  hydrateOfficialTemplate,
  type PrintableFormData,
  type PrintableFormLanguage,
} from "./officialFormHydrator";

interface OfficialFormFrameProps {
  template: string;
  data: PrintableFormData;
  language: PrintableFormLanguage;
}

const OfficialFormFrame = forwardRef<HTMLIFrameElement, OfficialFormFrameProps>(
  ({ template, data, language }, ref) => {
    const hydratedHtml = useMemo(
      () => hydrateOfficialTemplate(template, data, language),
      [data, language, template]
    );

    return (
      <iframe
        ref={ref}
        title={`PAO intake form ${language}`}
        srcDoc={hydratedHtml}
        className="h-[calc(100vh-190px)] min-h-[720px] w-full rounded-lg border border-[#D1D5DB] bg-white print:h-screen print:min-h-screen print:border-0"
      />
    );
  }
);

OfficialFormFrame.displayName = "OfficialFormFrame";

export default OfficialFormFrame;

