import { classifyError } from "@/lib/friendly-error";
import type { CanvasNodeData } from "@/types/canvas";

export function canvasNodeError(node: CanvasNodeData) {
    const errors = [node.metadata?.errorDetails, ...(node.metadata?.images || []).map((item) => item.errorDetails), ...(node.metadata?.texts || []).map((item) => item.errorDetails)];
    return errors.find((error) => classifyError(error || "") === "uncertain") || node.metadata?.errorDetails;
}
