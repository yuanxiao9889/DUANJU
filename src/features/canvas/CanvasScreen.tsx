import { ReactFlowProvider } from "@xyflow/react";

import { Canvas } from "./Canvas";

export function CanvasScreen() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
