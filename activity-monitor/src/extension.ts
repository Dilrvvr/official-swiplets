import { applicationIcon, installedApplications } from "@swipt/api/device";
import {
  kill,
  resourceUsage,
  type Process,
  type ProcessAttributes,
  type ResourceUsage,
  type SystemAttributes,
} from "@swipt/api/process";
import { defineAction, defineExtension, type Schema } from "@swipt/api/swiplet";

export type Usage = Omit<ResourceUsage, "system" | "processes"> & {
  readonly system: Partial<SystemAttributes>;
  readonly processes: readonly (Process & Partial<ProcessAttributes>)[];
};

interface Sampling {
  intervalMs: number;
  processAttributes: (keyof ProcessAttributes)[];
  systemAttributes: (keyof SystemAttributes)[];
}

export interface Application {
  bundleId: string;
  name: string;
}

const schema = <T>(
  jsonSchema: Record<string, unknown>,
  matches: (value: unknown) => boolean,
): Schema<T> => ({
  "~standard": {
    version: 1,
    vendor: "activity-monitor",
    validate: (value) =>
      matches(value)
        ? { value: value as T }
        : { issues: [{ message: "doesn't match the schema" }] },
    jsonSchema: {
      input: () => jsonSchema,
      output: () => jsonSchema,
    },
  },
});

const names = { type: "array", items: { type: "string" } };
const isNames = (value: unknown) =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const sampling = schema<Sampling>(
  {
    type: "object",
    properties: {
      intervalMs: { type: "integer", exclusiveMinimum: 0, multipleOf: 500 },
      processAttributes: names,
      systemAttributes: names,
    },
    required: ["intervalMs", "processAttributes", "systemAttributes"],
    additionalProperties: false,
  },
  (value) => {
    const { intervalMs, processAttributes, systemAttributes } = (value ??
      {}) as Partial<Record<keyof Sampling, unknown>>;
    return (
      typeof intervalMs === "number" &&
      intervalMs > 0 &&
      Number.isInteger(intervalMs / 500) &&
      isNames(processAttributes) &&
      isNames(systemAttributes)
    );
  },
);
const process = schema<{ pid: number }>(
  {
    type: "object",
    properties: { pid: { type: "integer", minimum: 0 } },
    required: ["pid"],
    additionalProperties: false,
  },
  (value) => {
    const pid = (value as { pid?: unknown } | null)?.pid;
    return Number.isSafeInteger(pid) && (pid as number) >= 0;
  },
);
const application = schema<{ bundleId: string }>(
  {
    type: "object",
    properties: { bundleId: { type: "string" } },
    required: ["bundleId"],
    additionalProperties: false,
  },
  (value) =>
    typeof (value as { bundleId?: unknown } | null)?.bundleId === "string",
);

export default defineExtension({
  actions: {
    usage: defineAction({
      title: "Watch the Resource Usage",
      input: sampling,
      stream: (sampling, { signal }): AsyncIterable<Usage> =>
        resourceUsage({ ...sampling, signal }),
    }),
    applications: defineAction({
      title: "List the Applications",
      run: async (_, { signal }): Promise<Application[]> =>
        (await installedApplications({ signal })).map(({ bundleId, name }) => ({
          bundleId,
          name,
        })),
    }),
    icon: defineAction({
      title: "Get the Icon of an Application",
      input: application,
      run: async ({ bundleId }, { signal }) =>
        (await applicationIcon(bundleId, { signal })).uri,
    }),
    terminate: defineAction({
      title: "Terminate a Process",
      input: process,
      run: ({ pid }, { signal }) => kill(pid, "SIGKILL", { signal }),
    }),
  },
});
