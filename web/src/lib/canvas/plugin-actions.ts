import { getNodeDefinition, getNodePluginId } from "./node-registry";
import { usePluginStore } from "@/stores/canvas/use-plugin-store";
import type { PluginActionParameters, CanvasNodeDefinition } from "@/types/canvas-plugin";

export type WorkflowPluginAction = { nodeType: string; pluginId: string; actionId: string; version: string; digest: string; parameters: PluginActionParameters };
const bundled = new WeakMap<CanvasNodeDefinition, string>();
export function markBundledAction(definition: CanvasNodeDefinition, revision: string) { bundled.set(definition, revision); }
export function planPluginAction(nodeType: string, parameters: unknown): WorkflowPluginAction {
    const definition = getNodeDefinition(nodeType), action = definition?.workflowAction;
    if (!definition || !action) throw new Error("处理插件未启用，请先启用原插件");
    const pluginId = getNodePluginId(nodeType);
    const record = usePluginStore.getState().plugins.find((plugin) => plugin.id === pluginId);
    const digest = bundled.get(definition) || (record?.enabled && record.sourceDigest);
    if (!digest) throw new Error("请先审阅并授权处理插件源码");
    return { nodeType, pluginId, actionId: action.id, version: action.version, digest, parameters: action.validate(parameters) };
}
export function resolvePluginAction(plan: WorkflowPluginAction) {
    const current = planPluginAction(plan.nodeType, plan.parameters);
    if (JSON.stringify(current) !== JSON.stringify(plan)) throw new Error("处理插件或参数已改变，请重新预览工作流");
    return getNodeDefinition(plan.nodeType)!.workflowAction!;
}
