import "streamdown/styles.css";
import "./styles/globals.css";
import "./styles/brand.css";
import { installWriteBarrier } from "@/lib/install-write-barrier";
import { prepareStorage } from "@/lib/prepare-storage";
void prepareStorage().then(() => {
    installWriteBarrier();
    return import("./start-app");
}).catch((error) => {
    console.error(error);
    document.getElementById("root")!.textContent = "本地数据读取失败，请保留原数据并刷新重试";
});
