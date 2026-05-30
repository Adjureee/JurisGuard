import { forwardRef } from "react";
import OfficialFormFrame from "./OfficialFormFrame";
import type { PrintableFormData } from "./officialFormHydrator";

interface PrintableFormFilipinoProps {
  template: string;
  data: PrintableFormData;
  onReady?: () => void;
}

const PrintableFormFilipino = forwardRef<HTMLIFrameElement, PrintableFormFilipinoProps>(
  ({ template, data, onReady }, ref) => (
    <OfficialFormFrame ref={ref} template={template} data={data} language="filipino" onReady={onReady} />
  )
);

PrintableFormFilipino.displayName = "PrintableFormFilipino";

export default PrintableFormFilipino;

