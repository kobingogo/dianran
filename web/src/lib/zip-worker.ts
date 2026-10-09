import { zipSync } from "fflate";

const workerScope = globalThis as unknown as {
    onmessage: (event: MessageEvent<Array<readonly [string, Uint8Array]>>) => void;
    postMessage: (data: Uint8Array, transfer: Transferable[]) => void;
};
workerScope.onmessage = ({ data }) => {
    const archive = zipSync(Object.fromEntries(data), { level: 0 });
    workerScope.postMessage(archive, [archive.buffer as ArrayBuffer]);
};
