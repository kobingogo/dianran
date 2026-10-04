import React from "react";
import { createRoot } from "react-dom/client";
import "streamdown/styles.css";
import "./styles/globals.css";
import "./styles/brand.css";
import { RouterProvider } from "react-router-dom";

import { AppProviders } from "@/components/layout/app-providers";
import "@/i18n";
import { initAnalytics } from "@/lib/analytics";
import { router } from "@/router";
import { installRequestTracker } from "@/features/tasks/request-tracker";
import { installPromptUsageFlush } from "@/services/usage-stats";

initAnalytics();
// [dianran] observe AI requests for real generation status (task center)
installRequestTracker();
// [dianran] anonymous prompt copy/use counts (see services/usage-stats.ts)
installPromptUsageFlush();

document.body.style.fontFamily = "var(--font-sans)";

createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <AppProviders>
            <RouterProvider router={router} />
        </AppProviders>
    </React.StrictMode>,
);
