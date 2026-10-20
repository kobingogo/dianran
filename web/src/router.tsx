import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from "react";
import { createBrowserRouter, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
import HomePage from "@/pages/home";
import NotFound from "@/pages/not-found";
import { RouteFallback } from "@/components/layout/route-fallback";

// [dianran] Route-level code splitting: only the shell + homepage ship in the first chunk.
const AssetsPage = lazy(() => import("@/pages/assets"));
const CanvasPage = lazy(() => import("@/pages/canvas"));
const CanvasProjectPage = lazy(() => import("@/pages/canvas/project"));
const ConfigPage = lazy(() => import("@/pages/config"));
const ImagePage = lazy(() => import("@/pages/image"));
const PromptsPage = lazy(() => import("@/pages/prompts"));
const VideoPage = lazy(() => import("@/pages/video"));

function page(Component: LazyExoticComponent<ComponentType>) {
    return (
        <Suspense fallback={<RouteFallback />}>
            <Component />
        </Suspense>
    );
}

export const router = createBrowserRouter([
    {
        element: (
            <UserLayout>
                <AnalyticsTracker />
                <Outlet />
            </UserLayout>
        ),
        children: [
            { path: "/", element: <HomePage /> },
            { path: "/image", element: page(ImagePage) },
            { path: "/video", element: page(VideoPage) },
            { path: "/assets", element: page(AssetsPage) },
            { path: "/prompts", element: page(PromptsPage) },
            { path: "/canvas", element: page(CanvasPage) },
            { path: "/canvas/:id", element: page(CanvasProjectPage) },
            { path: "/config", element: page(ConfigPage) },
        ],
    },
    { path: "*", element: <NotFound /> },
]);
