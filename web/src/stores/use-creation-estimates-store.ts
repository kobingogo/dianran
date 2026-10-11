import { businessOperation } from "@/lib/write-ownership";
import { create } from "zustand";
import { nanoid } from "nanoid";
import { canvasIndexedStorage } from "@/lib/localforage-storage";
import { storageKey } from "@/constant/brand";
import { conditionKey, validateQuote, type CreationQuote, type EstimateCondition, type TimingSample } from "@/lib/creation-estimates";
const key = storageKey("creation_estimates");
type Data = { quotes: CreationQuote[]; samples: TimingSample[] };
const empty = (): Data => ({ quotes: [], samples: [] });
let writes = Promise.resolve();
async function read() {
    const data = (await canvasIndexedStorage.getItem<Data>(key)) || empty();
    if (!Array.isArray(data.quotes) || !Array.isArray(data.samples)) throw new Error("估算数据损坏，原数据未覆盖");
    return data;
}
export const useCreationEstimatesStore = create<
    Data & {
        load: () => Promise<void>;
        quote: (condition: EstimateCondition, amount: number, currency: string, unit: CreationQuote["unit"], source: string) => Promise<void>;
        removeQuote: (id: string) => Promise<void>;
        record: (id: string, condition: EstimateCondition, durationMs: number) => Promise<void>;
        clearSamples: () => Promise<void>;
    }
>((set) => {
    const mutate = businessOperation((change: (data: Data) => Data) => {
        const next = writes.then(async () => {
            const data = change(await read());
            await canvasIndexedStorage.setItem(key, data);
            set(data);
        });
        writes = next.catch(() => {});
        return next;
    });
    return {
        ...empty(),
        load: async () => {
            await writes;
            set(await read());
        },
        quote: async (condition, amount, currency, unit, source) => {
            validateQuote(amount, currency, source, unit, condition);
            await mutate((data) => ({
                ...data,
                quotes: [
                    ...data.quotes.filter((item) => conditionKey(item.condition) !== conditionKey(condition)),
                    { id: nanoid(), condition: structuredClone(condition), amount, currency: currency.trim(), unit, source: source.trim(), recordedAt: Date.now() },
                ],
            }));
        },
        removeQuote: (id) => mutate((data) => ({ ...data, quotes: data.quotes.filter((quote) => quote.id !== id) })),
        record: (id, condition, durationMs) => {
            if (!Number.isFinite(durationMs) || durationMs <= 0) return Promise.resolve();
            return mutate((data) => ({ ...data, samples: [...data.samples.filter((sample) => sample.id !== id), { id, condition: structuredClone(condition), durationMs, recordedAt: Date.now() }] }));
        },
        clearSamples: () => mutate((data) => ({ ...data, samples: [] })),
    };
});
