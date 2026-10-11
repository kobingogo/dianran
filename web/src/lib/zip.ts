import { unzipSync } from "fflate";
import { createZipWorker } from "./zip-worker-client";

type ZipFile = {
    name: string;
    data: BlobPart;
};

export async function createZip(files: ZipFile[]) {
    const entries = await Promise.all(
        files.map(async (file) => {
            const data = new Uint8Array(await new Blob([file.data]).arrayBuffer());
            return [file.name, data] as const;
        }),
    );
    const archive = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
        const worker = createZipWorker();
        worker.onmessage = ({ data }) => { worker.terminate(); resolve(data); };
        worker.onerror = () => { worker.terminate(); reject(new Error("备份打包失败，作品仍在本机，请重试导出")); };
        try { worker.postMessage(entries, entries.map(([, data]) => data.buffer)); }
        catch (error) { worker.terminate(); reject(error); }
    });
    return new Blob([archive], { type: "application/zip" });
}

export async function readZip(file: Blob) {
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    return new Map(Object.entries(entries).map(([name, data]) => [name, new Blob([data])]));
}
