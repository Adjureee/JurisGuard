import { forwardRef } from "react";
import OfficialFormFrame from "./OfficialFormFrame";
import type { PrintableFormData } from "./officialFormHydrator";

interface PrintableFormEnglishProps {
  template: string;
  data: PrintableFormData;
  onLoad?: () => void;
}

const PrintableFormEnglish = forwardRef<HTMLIFrameElement, PrintableFormEnglishProps>(
  ({ template, data, onLoad }, ref) => (
    <OfficialFormFrame
      ref={ref}
      template={template}
      data={data}
      language="english"
      onLoad={onLoad}
    />
  )
);

PrintableFormEnglish.displayName = "PrintableFormEnglish";

export default PrintableFormEnglish;

