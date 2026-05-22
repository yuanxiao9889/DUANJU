import { ReactFlowProvider } from "@xyflow/react";
import { useEffect } from "react";

import { Canvas } from "./Canvas";

export function CanvasScreen() {
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.debug("[canvas-perf] CanvasScreen mounted", {
        at: Math.round(performance.now()),
      });
    }
  }, []);

  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
