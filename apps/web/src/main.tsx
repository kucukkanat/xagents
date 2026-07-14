import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { RouterProvider } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfigProvider } from "@/lib/config-context";
import { router } from "@/router";
import "@/index.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root not found");

createRoot(container).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider>
        <ConfigProvider>
          <RouterProvider router={router} />
          <Toaster richColors position="top-right" />
        </ConfigProvider>
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
