import { forwardRef } from "react";
import OfficialFormFrame from "./OfficialFormFrame";
import type { PrintableFormData } from "./officialFormHydrator";

interface PrintableFormFilipinoProps {
  template: string;
  data: PrintableFormData;
  onLoad?: () => void;
}

const PrintableFormFilipino = forwardRef<HTMLIFrameElement, PrintableFormFilipinoProps>(
  ({ template, data, onLoad }, ref) => (
    <OfficialFormFrame
      ref={ref}
      template={template}
      data={data}
      language="filipino"
      onLoad={onLoad}
    />
  )
);

PrintableFormFilipino.displayName = "PrintableFormFilipino";

export default PrintableFormFilipino;

