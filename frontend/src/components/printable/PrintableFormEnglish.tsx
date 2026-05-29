import { forwardRef } from "react";
import OfficialFormFrame from "./OfficialFormFrame";
import type { PrintableFormData } from "./officialFormHydrator";

interface PrintableFormEnglishProps {
  template: string;
  data: PrintableFormData;
}

const PrintableFormEnglish = forwardRef<HTMLIFrameElement, PrintableFormEnglishProps>(
  ({ template, data }, ref) => (
    <OfficialFormFrame ref={ref} template={template} data={data} language="english" />
  )
);

PrintableFormEnglish.displayName = "PrintableFormEnglish";

export default PrintableFormEnglish;
