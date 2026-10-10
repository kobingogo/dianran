import "streamdown/styles.css";
import "./styles/globals.css";
import "./styles/brand.css";
import { installWriteBarrier } from "@/lib/install-write-barrier";
installWriteBarrier();
void import("./start-app");
