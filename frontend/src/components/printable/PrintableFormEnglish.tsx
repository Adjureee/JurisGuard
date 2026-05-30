import { forwardRef } from "react";
import OfficialFormFrame from "./OfficialFormFrame";
import type { PrintableFormData } from "./officialFormHydrator";

interface PrintableFormEnglishProps {
  template: string;
  data: PrintableFormData;
  onReady?: () => void;
}

const PrintableFormEnglish = forwardRef<HTMLIFrameElement, PrintableFormEnglishProps>(
  ({ template, data, onReady }, ref) => (
    <OfficialFormFrame ref={ref} template={template} data={data} language="english" onReady={onReady} />
  )
);

PrintableFormEnglish.displayName = "PrintableFormEnglish";

export default PrintableFormEnglish;

