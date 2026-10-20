export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

/** Dot / line pitch in CSS pixels at zoom 1. */
export const CANVAS_GRID_SIZE = 28;

export const canvasThemes = {
    light: {
        canvas: {
            background: "#F5EFE4",
            dot: "rgba(27,25,22,.18)",
            line: "rgba(27,25,22,.08)",
            selectionStroke: "#1B1916",
            selectionFill: "rgba(27,25,22,.06)",
        },
        node: {
            label: "#3A362F",
            fill: "#ECE4D5",
            panel: "#FBF8F2",
            stroke: "#E3DACA",
            activeStroke: "#1B1916",
            placeholder: "#8C8478",
            text: "#1B1916",
            muted: "#6B645A",
            faint: "#8C8478",
        },
        toolbar: {
            panel: "rgba(251,248,242,.96)",
            border: "#E3DACA",
            item: "#3A362F",
            itemHover: "#ECE4D5",
            activeBg: "#ECE4D5",
            activeText: "#1B1916",
        },
    },
    dark: {
        canvas: {
            background: "#171512",
            dot: "rgba(241,235,224,.16)",
            line: "rgba(241,235,224,.07)",
            selectionStroke: "#F1EBE0",
            selectionFill: "rgba(241,235,224,.10)",
        },
        node: {
            label: "#D9D1C3",
            fill: "#2A2621",
            panel: "#211E1A",
            stroke: "#332E28",
            activeStroke: "#F1EBE0",
            placeholder: "#857D71",
            text: "#F1EBE0",
            muted: "#A69D8F",
            faint: "#857D71",
        },
        toolbar: {
            panel: "rgba(33,30,26,.96)",
            border: "#332E28",
            item: "#D9D1C3",
            itemHover: "#2A2621",
            activeBg: "#3A352E",
            activeText: "#F1EBE0",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
