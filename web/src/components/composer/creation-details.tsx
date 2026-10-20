import { useState } from "react";
import { Modal } from "antd";
import { InkButton } from "@/components/ui/ink-button";
import type { CreationSnapshot } from "@/lib/composer";
import { modelOptionName } from "@/stores/use-config-store";

export function CreationDetails({ creation }: { creation?: CreationSnapshot }) {
    const [open, setOpen] = useState(false);
    if (!creation) return null;
    return (
        <>
            <InkButton size={32} variant="ghost" onClick={() => setOpen(true)}>
                本轮参数
            </InkButton>
            <Modal title="本轮实际参数" open={open} onCancel={() => setOpen(false)} footer={null}>
                <p className="whitespace-pre-wrap text-sm text-[color:var(--ink-700)]">{creation.prompt}</p>
                <p className="text-xs text-[color:var(--ink-500)]">
                    {modelOptionName(creation.parameters[creation.mode === "image" ? "imageModel" : "videoModel"])} · {creation.referenceIds.length} 张参考图
                </p>
                <pre className="overflow-x-auto rounded-lg bg-[var(--paper-1)] p-3 text-xs text-[color:var(--ink-700)]">{JSON.stringify(creation.actual, null, 2)}</pre>
            </Modal>
        </>
    );
}
