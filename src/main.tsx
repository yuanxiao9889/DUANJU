import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./i18n";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const appTree = (
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
);

const enableStrictMode = import.meta.env.VITE_REACT_STRICT_MODE === "true";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  enableStrictMode ? <React.StrictMode>{appTree}</React.StrictMode> : appTree,
);
