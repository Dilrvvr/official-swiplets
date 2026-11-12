import "expo-sqlite/localStorage/install";

import {
  Alert,
  BottomSheet,
  Button,
  Circle,
  ContentUnavailableView,
  Form,
  Group,
  HStack,
  Host,
  Image,
  LabeledContent,
  List,
  NavigationStack,
  Picker,
  Popover,
  ProgressView,
  Section,
  Spacer,
  Text,
  Toggle,
  Toolbar,
  ToolbarItem,
  useNativeState,
  VStack,
  ZStack,
} from "@expo/ui/swift-ui";
import {
  background,
  buttonStyle,
  clipShape,
  contentShape,
  contentTransition,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  labelStyle,
  lineLimit,
  listRowBackground,
  listRowInsets,
  listSectionSpacing,
  monospacedDigit,
  navigationBarTitleDisplayMode,
  navigationTitle,
  padding,
  pickerStyle,
  presentationDetents,
  resizable,
  searchable,
  shapes,
  tag,
  textSelection,
  truncationMode,
} from "@expo/ui/swift-ui/modifiers";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  DynamicColorIOS,
  PlatformColor,
  useWindowDimensions,
  type ColorValue,
} from "react-native";
import { preferredLocalizations } from "@swipt/api/localization";
import type { ProcessAttributes, SystemAttributes } from "@swipt/api/process";
import {
  Chart,
  DataGrid,
  type ChartAxis,
  type ChartMark,
  type ChartScale,
  type DataGridColumn,
  type DataGridFont,
} from "@swipt/api/swift-ui";
import { actions, exit } from "@swipt/api/swiplet";

import locales from "../locales.json";
import type extension from "./extension";
import type { Usage } from "./extension";

const table: Record<string, Partial<typeof locales.en>> = locales;
const [language] = preferredLocalizations(Object.keys(locales));
const strings: typeof locales.en = Object.assign(
  {},
  locales.en,
  ...preferredLocalizations(Object.keys(locales))
    .map((localization) => table[localization])
    .reverse(),
);

const monitor = actions<typeof extension>();

const intervalMs = 1000;
const historyLength = 60;
const historySeconds = (historyLength * intervalMs) / 1000;

const blue = PlatformColor("systemBlue");
const red = PlatformColor("systemRed");
const green = PlatformColor("systemGreen");
const yellow = PlatformColor("systemYellow");
const purple = PlatformColor("systemPurple");
const gray = PlatformColor("systemGray");
const faint = PlatformColor("tertiaryLabel");
const stripes = [
  DynamicColorIOS({ light: "#FFFFFF", dark: "#000000" }),
  DynamicColorIOS({ light: "#F6F6F7", dark: "#0F0F10" }),
];
const secondary = foregroundStyle({ type: "hierarchical", style: "secondary" });

const decimal = new Intl.NumberFormat(language, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const round = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat(language, { maximumFractionDigits: 0 });
const share = new Intl.NumberFormat(language, {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const percent = new Intl.NumberFormat(language, {
  style: "percent",
  maximumFractionDigits: 1,
});

const units = ["B", "KB", "MB", "GB", "TB"];
const scaled = (value: number, base: number, fraction = decimal) => {
  let unit = 0;
  while (value >= base && unit < units.length - 1) {
    value /= base;
    unit++;
  }
  return `${(unit === 0 || value >= 100 ? integer : fraction).format(value)} ${units[unit]}`;
};
const memory = (value: number) => scaled(value, 1024);
const data = (value: number) => scaled(value, 1000);
const rate = (value: number) => `${data(value)}/s`;
const elapsed = (ms: number) => {
  const seconds = ms / 1000;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = (seconds % 60).toFixed(2).padStart(5, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}`
    : `${minutes}:${rest}`;
};

type Sampled = Usage["processes"][number];

const perSecond = (
  now: number | undefined,
  before: number | undefined,
  seconds: number,
  step = 1,
) =>
  now === undefined || before === undefined || seconds <= 0
    ? undefined
    : Math.round(Math.max(now - before, 0) / seconds / step) * step;

const tenths = (value: number | undefined) =>
  value === undefined ? undefined : Math.round(value * 10) / 10;

const display = (
  value: number | undefined,
  format: (value: number) => string,
) => (value === undefined ? "" : format(value));

interface Column {
  readonly id: string;
  readonly title: string;
  readonly attributes: readonly (keyof ProcessAttributes)[];
  readonly value: (
    process: Sampled,
    earlier: Sampled | undefined,
    seconds: number,
  ) => number | undefined;
  readonly format: (value: number) => string;
}

const count = (
  id: string,
  title: string,
  attribute: keyof ProcessAttributes,
  format: (value: number) => string = (value) => integer.format(value),
): Column => ({
  id,
  title,
  attributes: [attribute],
  value: (process) =>
    process[attribute] === undefined ? undefined : Number(process[attribute]),
  format,
});

const flag = (
  id: string,
  title: string,
  attribute: keyof ProcessAttributes,
): Column =>
  count(id, title, attribute, (value) =>
    value > 0 ? strings.yes : strings.no,
  );

const columnGroups: readonly (readonly Column[])[] = [
  [
    {
      id: "cpu",
      title: strings.cpu,
      attributes: ["cpuUsage"],
      value: (process) => tenths(process.cpuUsage),
      format: (value) => share.format(value / 100),
    },
    {
      id: "cpuTime",
      title: strings.cpuTime,
      attributes: ["cpuTotalUser", "cpuTotalSystem"],
      value: (process) =>
        ((process.cpuTotalUser ?? 0) + (process.cpuTotalSystem ?? 0)) / 1e6,
      format: elapsed,
    },
    count("threads", strings.threads, "threadCount"),
    {
      id: "idleWakeUps",
      title: strings.idleWakeUps,
      attributes: ["platIdleWakeups"],
      value: (process, earlier, seconds) =>
        perSecond(process.platIdleWakeups, earlier?.platIdleWakeups, seconds),
      format: (value) => integer.format(value),
    },
    {
      id: "energy",
      title: strings.energy,
      attributes: ["powerScore"],
      value: (process) => tenths(process.powerScore),
      format: (value) => decimal.format(value),
    },
  ],
  [
    count("memory", strings.memory, "physFootprint", memory),
    count("realMemory", strings.realMemory, "memResidentSize", memory),
    count("privateMemory", strings.privateMemory, "memRPrvt", memory),
    count("sharedMemory", strings.sharedMemory, "memRShrd", memory),
    count(
      "compressedMemory",
      strings.compressedMemory,
      "memCompressed",
      memory,
    ),
    count("purgeableMemory", strings.purgeableMemory, "memPurgeable", memory),
  ],
  [
    {
      id: "disk",
      title: strings.disk,
      attributes: ["diskBytesRead", "diskBytesWritten"],
      value: (process, earlier, seconds) =>
        perSecond(
          (process.diskBytesRead ?? 0) + (process.diskBytesWritten ?? 0),
          earlier === undefined
            ? undefined
            : (earlier.diskBytesRead ?? 0) + (earlier.diskBytesWritten ?? 0),
          seconds,
          100,
        ),
      format: rate,
    },
    count("dataRead", strings.dataRead, "diskBytesRead", data),
    count("dataWritten", strings.dataWritten, "diskBytesWritten", data),
  ],
  [
    count("contextSwitches", strings.contextSwitches, "ctxSwitch"),
    count("faults", strings.faults, "faults"),
    count("pageIns", strings.pageIns, "vmPageIns"),
    count("machSystemCalls", strings.machSystemCalls, "sysCallsMach"),
    count("unixSystemCalls", strings.unixSystemCalls, "sysCallsUnix"),
    count("messagesSent", strings.messagesSent, "msgSent"),
    count("messagesReceived", strings.messagesReceived, "msgRecv"),
    count("ports", strings.ports, "machPortCount"),
  ],
  [
    {
      id: "pid",
      title: strings.processId,
      attributes: [],
      value: (process) => process.pid,
      format: String,
    },
    count("ppid", "PPID", "ppid", String),
    count("userId", strings.userId, "uid", String),
    flag("sandbox", strings.sandbox, "__sandbox"),
    flag("restricted", strings.restricted, "__restricted"),
  ],
];
const columns = columnGroups.flat();

const systemAttributes = [
  "threadCount",
  "physMemSize",
  "vmActiveCount",
  "vmInactiveCount",
  "vmFreeCount",
  "vmSpeculativeCount",
  "vmWireCount",
  "vmCompressorPageCount",
  "vmIntPageCount",
  "vmExtPageCount",
  "vmPurgeableCount",
  "diskBytesRead",
  "diskBytesWritten",
  "netBytesIn",
  "netBytesOut",
] as const satisfies readonly (keyof SystemAttributes)[];

const processAttributes = [
  "name",
  "uid",
  "cpuUsage",
  "cpuTotalUser",
  "cpuTotalSystem",
  "physFootprint",
  "threadCount",
  "powerScore",
  "diskBytesRead",
  "diskBytesWritten",
] as const satisfies readonly (keyof ProcessAttributes)[];

const filters = ["allProcesses", "applications"] as const;
type Filter = (typeof filters)[number];

type Pressure = "normal" | "warning" | "critical";

// The levels vm_pressure_response moves between while the compressor is active, with the
// thresholds of !XNU_TARGET_OS_OSX (osfmk/vm/vm_pageout.c and vm_compressor.c, xnu-12377.1.9).
const pressureAfter = (before: Pressure, uncompressed: number): Pressure => {
  if (before === "normal") {
    return uncompressed < 0.3
      ? "critical"
      : uncompressed < 0.5
        ? "warning"
        : "normal";
  }
  if (uncompressed > 0.6) {
    return "normal";
  }
  return before === "warning"
    ? uncompressed < 0.3
      ? "critical"
      : "warning"
    : uncompressed > 0.35
      ? "warning"
      : "critical";
};

interface Measured {
  readonly time: number;
  readonly cpu?: number;
  readonly user?: number;
  readonly system?: number;
  readonly threads: number;
  readonly processes: number;
  readonly memory: {
    readonly total: number;
    readonly app: number;
    readonly wired: number;
    readonly compressed: number;
    readonly cached: number;
    readonly pressure: number;
    readonly level: Pressure;
  };
  readonly read?: number;
  readonly written?: number;
  readonly received?: number;
  readonly sent?: number;
  readonly totals: {
    readonly read: number;
    readonly written: number;
    readonly received: number;
    readonly sent: number;
  };
}

interface Point extends Measured {
  readonly x: number;
}

const measure = (
  sample: Usage,
  previous: Usage | undefined,
  level: Pressure,
): Measured => {
  const seconds =
    previous === undefined ? 0 : (sample.time - previous.time) / 1000;
  const cores = sample.cpuLoadPerCore;
  const cpu =
    cores.length === 0
      ? undefined
      : cores.reduce((sum, core) => sum + core, 0) / cores.length;
  const before = new Map(
    previous?.processes.map((process) => [process.pid, process]),
  );
  let user = 0;
  let system = 0;
  for (const process of sample.processes) {
    const earlier = before.get(process.pid);
    if (earlier !== undefined) {
      user += Math.max(
        (process.cpuTotalUser ?? 0) - (earlier.cpuTotalUser ?? 0),
        0,
      );
      system += Math.max(
        (process.cpuTotalSystem ?? 0) - (earlier.cpuTotalSystem ?? 0),
        0,
      );
    }
  }
  const kernel = user + system > 0 ? system / (user + system) : 0;
  const pages = (count: number | undefined) => (count ?? 0) * sample.pageSize;
  const internal = sample.system.vmIntPageCount ?? 0;
  const purgeable = sample.system.vmPurgeableCount ?? 0;
  const earlier = previous?.system;
  const compressor = sample.system.vmCompressorPageCount ?? 0;
  const uncompressed =
    (sample.system.vmActiveCount ?? 0) +
    (sample.system.vmInactiveCount ?? 0) +
    (sample.system.vmFreeCount ?? 0) +
    (sample.system.vmSpeculativeCount ?? 0);
  const available = Math.max(uncompressed + compressor, 1);
  return {
    time: sample.time,
    cpu,
    user: cpu === undefined ? undefined : cpu * (1 - kernel),
    system: cpu === undefined ? undefined : cpu * kernel,
    threads: sample.system.threadCount ?? 0,
    processes: sample.processes.length,
    memory: {
      pressure: (compressor / available) * 100,
      level: pressureAfter(level, uncompressed / available),
      total: pages(sample.system.physMemSize),
      app: pages(internal - Math.min(purgeable, internal)),
      wired: pages(sample.system.vmWireCount),
      compressed: pages(sample.system.vmCompressorPageCount),
      cached: pages((sample.system.vmExtPageCount ?? 0) + purgeable),
    },
    read: perSecond(
      sample.system.diskBytesRead,
      earlier?.diskBytesRead,
      seconds,
    ),
    written: perSecond(
      sample.system.diskBytesWritten,
      earlier?.diskBytesWritten,
      seconds,
    ),
    received: perSecond(sample.system.netBytesIn, earlier?.netBytesIn, seconds),
    sent: perSecond(sample.system.netBytesOut, earlier?.netBytesOut, seconds),
    totals: {
      read: sample.system.diskBytesRead ?? 0,
      written: sample.system.diskBytesWritten ?? 0,
      received: sample.system.netBytesIn ?? 0,
      sent: sample.system.netBytesOut ?? 0,
    },
  };
};

const useSamples = (attributes: readonly (keyof ProcessAttributes)[]) => {
  const [state, setState] = useState<{
    readonly samples: readonly Usage[];
    readonly measured: readonly Measured[];
  }>({ samples: [], measured: [] });
  const [failure, setFailure] = useState<string>();
  const key = attributes.join("\n");
  useEffect(() => {
    const controller = new AbortController();
    const watch = async () => {
      for await (const sample of monitor.usage(
        {
          intervalMs,
          processAttributes: [...attributes],
          systemAttributes: [...systemAttributes],
        },
        { signal: controller.signal },
      )) {
        setState((state) => {
          const { samples, measured } = state;
          if (sample.cpuLoadPerCore.length === 0 && samples.length > 0) {
            return state;
          }
          return {
            samples: [...samples, sample].slice(-historyLength - 1),
            measured: [
              ...measured,
              measure(
                sample,
                samples.at(-1),
                measured.at(-1)?.memory.level ?? "normal",
              ),
            ].slice(-historyLength),
          };
        });
      }
    };
    watch().catch((error: Error) => {
      if (!controller.signal.aborted) {
        setFailure(error.message);
      }
    });
    return () => controller.abort();
  }, [key]);
  return { ...state, failure };
};

const useApplications = (sample: Usage | undefined) => {
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [icons, setIcons] = useState<ReadonlyMap<string, string>>(new Map());
  const requested = useRef(new Set<string>());
  useEffect(() => {
    monitor
      .applications()
      .then(
        (list) => setNames(new Map(list.map((it) => [it.bundleId, it.name]))),
        reportError,
      );
  }, []);
  const running = useMemo(
    () =>
      [
        ...new Set(
          (sample?.processes ?? []).flatMap((process) =>
            process.bundleId === undefined ? [] : [process.bundleId],
          ),
        ),
      ].sort(),
    [sample],
  );
  const runningKey = running.join("\n");
  useEffect(() => {
    for (const bundleId of running) {
      if (requested.current.has(bundleId)) {
        continue;
      }
      requested.current.add(bundleId);
      monitor
        .icon({ bundleId })
        .then(
          (uri) => setIcons((current) => new Map(current).set(bundleId, uri)),
          reportError,
        );
    }
  }, [runningKey]);
  return { names, icons };
};

interface Row {
  readonly process: Sampled;
  readonly pid: number;
  readonly name: string;
  readonly owner?: string;
  readonly icon?: string;
  readonly values: Readonly<Record<string, number | undefined>>;
}

const rowsOf = (
  sample: Usage,
  previous: Usage | undefined,
  names: ReadonlyMap<string, string>,
  icons: ReadonlyMap<string, string>,
  shown: readonly Column[],
): Row[] => {
  const bundles = sample.processes.flatMap((process) =>
    process.bundleId === undefined || process.executablePath === undefined
      ? []
      : ([
          [
            process.executablePath.slice(
              0,
              process.executablePath.lastIndexOf("/") + 1,
            ),
            process.bundleId,
          ],
        ] as const),
  );
  const before = new Map(
    previous?.processes.map((process) => [process.pid, process]),
  );
  const seconds =
    previous === undefined ? 0 : (sample.time - previous.time) / 1000;
  return sample.processes.map((process) => {
    const bundle =
      process.bundleId ??
      bundles.find(([directory]) =>
        process.executablePath?.startsWith(directory),
      )?.[1];
    const application = bundle === undefined ? undefined : names.get(bundle);
    const earlier = before.get(process.pid);
    const name = process.name ?? "";
    return {
      process,
      pid: process.pid,
      name: process.bundleId === undefined ? name : (application ?? name),
      owner: process.bundleId === undefined ? application : undefined,
      icon: bundle === undefined ? undefined : icons.get(bundle),
      values: Object.fromEntries(
        shown.map((column) => [
          column.id,
          column.value(process, earlier, seconds),
        ]),
      ),
    };
  });
};

interface Sort {
  readonly column: string;
  readonly order: "ascending" | "descending";
}

const byName: Sort = { column: "name", order: "ascending" };

interface ViewOptions {
  readonly filter: Filter;
  readonly visible: readonly string[];
  readonly setFilter: (filter: Filter) => void;
  readonly show: (id: string, shown: boolean) => void;
}

const ViewOptionsContext = createContext<ViewOptions | undefined>(undefined);

function ViewOptionsProvider({ children }: { children: ReactElement }) {
  const { width, height } = useWindowDimensions();
  const [filter, setFilter] = useState<Filter>("allProcesses");
  const [visible, setVisible] = useState<readonly string[]>(() => {
    const stored = localStorage.getItem("columns");
    if (stored !== null) {
      return JSON.parse(stored);
    }
    return width >= 700 && height >= 600
      ? ["cpu", "memory", "energy", "disk", "cpuTime", "pid"]
      : ["cpu", "memory", "energy"];
  });
  useEffect(() => {
    localStorage.setItem("columns", JSON.stringify(visible));
  }, [visible]);
  const show = useCallback((id: string, shown: boolean) => {
    setVisible((current) =>
      shown ? [...current, id] : current.filter((column) => column !== id),
    );
  }, []);
  const options = useMemo(
    () => ({ filter, visible, setFilter, show }),
    [filter, visible, show],
  );
  return (
    <ViewOptionsContext.Provider value={options}>
      {children}
    </ViewOptionsContext.Provider>
  );
}

export default function App() {
  return (
    <ViewOptionsProvider>
      <Host style={{ flex: 1 }}>
        <NavigationStack>
          <Toolbar
            modifiers={[
              navigationTitle(strings.title),
              navigationBarTitleDisplayMode("inline"),
            ]}
          >
            <Monitor />
            <Toolbar.Content>
              <ToolbarItem placement="topBarLeading">
                <Button
                  label={strings.back}
                  systemImage="chevron.left"
                  onPress={exit}
                />
              </ToolbarItem>
              <ToolbarItem placement="topBarTrailing">
                <ViewMenu />
              </ToolbarItem>
            </Toolbar.Content>
          </Toolbar>
        </NavigationStack>
      </Host>
    </ViewOptionsProvider>
  );
}

function ViewMenu() {
  const [isPresented, setPresented] = useState(false);
  return (
    <Popover isPresented={isPresented} onIsPresentedChange={setPresented}>
      <Popover.Trigger>
        <Button
          label={strings.view}
          systemImage="ellipsis"
          modifiers={[labelStyle("iconOnly")]}
          onPress={() => setPresented(true)}
        />
      </Popover.Trigger>
      <Popover.Content>
        <ViewOptionsForm />
      </Popover.Content>
    </Popover>
  );
}

function ViewOptionsForm() {
  const { width, height } = useWindowDimensions();
  const { filter, visible, setFilter, show } = useContext(ViewOptionsContext)!;
  return (
    <Form
      modifiers={[
        frame({
          width: Math.min(width - 32, 360),
          height: Math.min(height - 160, 600),
        }),
      ]}
    >
      <Section title={strings.filter}>
        <Picker
          selection={filter}
          onSelectionChange={setFilter}
          modifiers={[pickerStyle("inline")]}
        >
          {filters.map((filter) => (
            <Text key={filter} modifiers={[tag(filter)]}>
              {strings[filter]}
            </Text>
          ))}
        </Picker>
      </Section>
      <Section title={strings.section}>
        {columns.map((column) => (
          <Toggle
            key={column.id}
            label={column.title}
            isOn={visible.includes(column.id)}
            onIsOnChange={(value) => show(column.id, value)}
          />
        ))}
      </Section>
    </Form>
  );
}

function Monitor() {
  const { width, height } = useWindowDimensions();
  const wide = width >= 700 && height >= 600;
  const { filter, visible } = useContext(ViewOptionsContext)!;
  const [sort, setSort] = useState<Sort>({
    column: "cpu",
    order: "descending",
  });
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number>();
  const [quit, setQuit] = useState<ReadonlyMap<number, number>>(new Map());
  const [failure, setFailure] = useState<string>();
  const [expanded, setExpanded] = useState<PanelKind>();
  const query = useNativeState("");
  const shown = useMemo(
    () => columns.filter((column) => visible.includes(column.id)),
    [visible],
  );
  const attributes = useMemo(
    () => [
      ...new Set([
        ...processAttributes,
        ...shown.flatMap((column) => column.attributes),
      ]),
    ],
    [shown],
  );
  const { samples, measured, failure: unavailable } = useSamples(attributes);
  const sample = samples.at(-1);
  const { names, icons } = useApplications(sample);
  const history = useMemo(() => {
    const latest = measured.at(-1)?.time ?? 0;
    return measured.map((point) => ({
      ...point,
      x: (point.time - latest) / 1000,
    }));
  }, [measured]);
  const all = useMemo(
    () =>
      sample === undefined
        ? []
        : rowsOf(sample, samples.at(-2), names, icons, shown).filter(
            (row) => sample.time - (quit.get(row.pid) ?? 0) > 10_000,
          ),
    [samples, names, icons, shown, quit],
  );
  const sorting =
    sort.column === "name" || shown.some((column) => column.id === sort.column)
      ? sort
      : byName;
  const needle = search.trim().toLowerCase();
  const rows = useMemo(
    () =>
      all
        .filter(
          (row) =>
            (filter !== "applications" || row.process.bundleId !== undefined) &&
            (needle === "" ||
              row.name.toLowerCase().includes(needle) ||
              (row.process.name ?? "").toLowerCase().includes(needle) ||
              String(row.pid) === needle ||
              (row.process.bundleId ?? "").toLowerCase().includes(needle)),
        )
        .sort((a, b) => {
          const result =
            sorting.column === "name"
              ? a.name.localeCompare(b.name, language)
              : (a.values[sorting.column] ?? -1) -
                (b.values[sorting.column] ?? -1);
          return (
            (sorting.order === "descending" ? -result : result) || a.pid - b.pid
          );
        }),
    [all, filter, needle, sorting],
  );
  const chosen = all.find((row) => row.pid === selected);
  const terminate = (row: Row) =>
    monitor.terminate({ pid: row.pid }).then(
      () => {
        setQuit((current) => new Map(current).set(row.pid, sample?.time ?? 0));
        setSelected(undefined);
      },
      (error: Error) => {
        setFailure(error.message);
        setSelected(row.pid);
      },
    );
  const select = (pid: number | undefined) => {
    setFailure(undefined);
    setSelected(pid);
  };

  const perRow = width >= 1000 ? 4 : 2;
  const compact = (width - 16 * (perRow + 1)) / perRow < 240;
  const surface = PlatformColor("secondarySystemBackground");
  const tableColumns = useMemo<DataGridColumn<Row>[]>(() => {
    const font: DataGridFont | undefined = wide
      ? undefined
      : { textStyle: "subheadline" };
    const name = (row: Row) =>
      row.icon === undefined
        ? row.name
        : { text: row.name, image: { uri: row.icon } };
    const longest = rows.reduce<Row | undefined>(
      (longest, row) =>
        longest === undefined || row.name.length > longest.name.length
          ? row
          : longest,
      undefined,
    );
    return [
      {
        header:
          strings[filter === "applications" ? "applications" : "processes"],
        font,
        maxWidth: wide ? 300 : 170,
        imageSize: wide ? 24 : 20,
        cell: name,
        prototype: longest === undefined ? undefined : name(longest),
      },
      ...shown.map((column): DataGridColumn<Row> => ({
        header: column.title,
        alignment: "trailing",
        monospacedDigit: true,
        font,
        cell: (row) => {
          const value = row.values[column.id];
          return {
            text: display(value, column.format),
            color: value ? undefined : faint,
          };
        },
        prototype: column.format(
          rows.reduce(
            (largest, row) => Math.max(largest, row.values[column.id] ?? 0),
            0,
          ),
        ),
      })),
    ];
  }, [rows, shown, filter, wide]);
  const sorted = shown.findIndex((column) => column.id === sorting.column) + 1;

  const content =
    unavailable !== undefined ? (
      <Text modifiers={[textSelection(true), padding({ all: 20 })]}>
        {unavailable}
      </Text>
    ) : sample === undefined ? (
      <ProgressView />
    ) : (
      <VStack spacing={0}>
        {!wide && needle !== "" ? undefined : (
          <VStack
            spacing={12}
            modifiers={[padding({ horizontal: 16, top: 8, bottom: 14 })]}
          >
            {Array.from({ length: panelKinds.length / perRow }, (_, index) => (
              <HStack
                key={index}
                spacing={12}
                modifiers={[fixedSize({ horizontal: false, vertical: true })]}
              >
                {panelKinds
                  .slice(index * perRow, (index + 1) * perRow)
                  .map((kind) => (
                    <SystemPanel
                      key={kind}
                      kind={kind}
                      history={history}
                      compact={compact}
                      surface={surface}
                      onPress={compact ? () => setExpanded(kind) : undefined}
                    />
                  ))}
              </HStack>
            ))}
          </VStack>
        )}
        {rows.length === 0 && needle !== "" ? (
          <ContentUnavailableView
            title={strings.noResults}
            systemImage="magnifyingglass"
            modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}
          />
        ) : (
          <DataGrid
            data={rows}
            columns={tableColumns}
            keyExtractor={(row) => String(row.pid)}
            frozenColumns={1}
            rowHeight={wide ? 40 : 36}
            headerHeight={36}
            headerFont={{ textStyle: "subheadline", weight: "semibold" }}
            headerColor={PlatformColor("secondaryLabel")}
            rowColors={stripes}
            sortIndicator={{ column: sorted, order: sorting.order }}
            onCellPress={(key) => select(Number(key))}
            onHeaderPress={(index) => {
              const column = index === 0 ? "name" : shown[index - 1]?.id;
              if (column !== undefined) {
                setSort({
                  column,
                  order:
                    sorting.column === column
                      ? sorting.order === "ascending"
                        ? "descending"
                        : "ascending"
                      : column === "name"
                        ? "ascending"
                        : "descending",
                });
              }
            }}
          />
        )}
      </VStack>
    );

  return (
    <ZStack modifiers={[searchable(query, { onChange: setSearch })]}>
      {content}
      <BottomSheet
        isPresented={chosen !== undefined}
        onIsPresentedChange={(presented) => {
          if (!presented) {
            select(undefined);
          }
        }}
      >
        <Group modifiers={[presentationDetents(["medium", "large"])]}>
          {chosen === undefined ? undefined : (
            <Process
              row={chosen}
              samples={samples}
              failure={failure}
              onForceQuit={() => terminate(chosen)}
            />
          )}
        </Group>
      </BottomSheet>
      <BottomSheet
        isPresented={expanded !== undefined && compact}
        onIsPresentedChange={(presented) => {
          if (!presented) {
            setExpanded(undefined);
          }
        }}
      >
        <Group
          modifiers={[
            presentationDetents([{ height: 300 }]),
            padding({ horizontal: 20, top: 28, bottom: 8 }),
          ]}
        >
          {expanded === undefined ? undefined : (
            <SystemPanel kind={expanded} history={history} chartHeight={170} />
          )}
        </Group>
      </BottomSheet>
    </ZStack>
  );
}

function Icon({ uri, size }: { uri?: string; size: number }) {
  return uri === undefined ? (
    <Image
      systemName="gearshape"
      size={size * 0.62}
      color={faint}
      modifiers={[frame({ width: size, height: size })]}
    />
  ) : (
    <Image
      uiImage={uri}
      modifiers={[
        resizable(),
        frame({ width: size, height: size }),
        clipShape("roundedRectangle", size * 0.225),
      ]}
    />
  );
}

const hiddenAxes = { xAxis: "hidden", yAxis: "hidden" } as const;

const timeScale = (points: readonly { readonly x: number }[]): ChartScale => ({
  domain: [Math.min(points[0]?.x ?? 0, -historySeconds), 0],
});

const halves = (
  limit: number,
  label: (value: number) => string,
): ChartAxis => ({
  values: [limit / 2, limit].map((value) => ({ value, label: label(value) })),
  ticks: false,
});

const ceiling = (value: number, floor: number) => {
  let limit = floor;
  while (limit < value) {
    limit *= 10;
  }
  return [0.1, 0.2, 0.5, 1]
    .map((step) => limit * step)
    .find((step) => step >= value && step >= floor)!;
};

interface Series {
  readonly label: string;
  readonly color: ColorValue;
  readonly value: (point: Point) => number | undefined;
  readonly total?: (point: Point) => number;
}

const seriesData = (history: readonly Point[], series: readonly Series[]) =>
  history.flatMap((point) =>
    series.flatMap(({ label, value }) => {
      const y = value(point);
      return y === undefined ? [] : [{ x: point.x, y, series: label }];
    }),
  );

const seriesColors = (series: readonly Series[]) =>
  Object.fromEntries(series.map(({ label, color }) => [label, color]));

const trend = (
  points: readonly { readonly x: number; readonly y: number }[],
  color: ColorValue,
): ChartMark[] => [
  {
    type: "area",
    data: points,
    interpolation: "monotone",
    foregroundStyle: color,
    opacity: 0.18,
  },
  {
    type: "line",
    data: points,
    interpolation: "monotone",
    foregroundStyle: color,
    lineStyle: { width: 1.5 },
  },
];

const cpuSeries: readonly Series[] = [
  { label: strings.system, color: red, value: (point) => point.system },
  { label: strings.user, color: blue, value: (point) => point.user },
];
const pressureColors = { normal: green, warning: yellow, critical: red };
const used = ({ app, wired, compressed }: Point["memory"]) =>
  app + wired + compressed;
const diskSeries: readonly Series[] = [
  {
    label: strings.read,
    color: blue,
    value: (point) => point.read,
    total: (point) => point.totals.read,
  },
  {
    label: strings.written,
    color: red,
    value: (point) => point.written,
    total: (point) => point.totals.written,
  },
];
const networkSeries: readonly Series[] = [
  {
    label: strings.upload,
    color: red,
    value: (point) => point.sent,
    total: (point) => point.totals.sent,
  },
  {
    label: strings.download,
    color: blue,
    value: (point) => point.received,
    total: (point) => point.totals.received,
  },
];

const panelKinds = ["cpu", "memory", "disk", "network"] as const;
type PanelKind = (typeof panelKinds)[number];

function SystemPanel({
  kind,
  history,
  compact = false,
  surface,
  chartHeight = 92,
  onPress,
}: {
  kind: PanelKind;
  history: readonly Point[];
  compact?: boolean;
  surface?: ColorValue;
  chartHeight?: number;
  onPress?: () => void;
}) {
  const latest = history.at(-1);
  const size = compact
    ? frame({ height: 40 })
    : frame({
        minHeight: chartHeight,
        idealHeight: chartHeight,
        maxHeight: Infinity,
      });
  const xScale = timeScale(history);
  const axes = (yAxis: ChartAxis) =>
    compact ? hiddenAxes : ({ xAxis: "hidden", yAxis } as const);
  const percentAxis = halves(100, (value) => percent.format(value / 100));
  let value: string;
  let detail: string | undefined;
  let chart: ReactElement;
  let footer: ReactElement;
  switch (kind) {
    case "cpu": {
      value = display(latest?.cpu, (cpu) => share.format(cpu / 100));
      chart = (
        <Chart
          marks={[
            {
              type: "area",
              data: seriesData(history, cpuSeries),
              stacking: "standard",
              interpolation: "monotone",
              opacity: 0.8,
            },
          ]}
          seriesColors={seriesColors(cpuSeries)}
          legend="hidden"
          xScale={xScale}
          yScale={{ domain: [0, 100] }}
          {...axes(percentAxis)}
          modifiers={[size]}
        />
      );
      footer = (
        <Stats
          columns={[
            [
              ...cpuSeries.map(({ label, color, value }) => ({
                label,
                color,
                value: display(latest && value(latest), (load) =>
                  share.format(load / 100),
                ),
              })),
              {
                label: strings.idle,
                color: gray,
                value: display(latest?.cpu, (cpu) =>
                  share.format((100 - cpu) / 100),
                ),
              },
            ],
            [
              {
                label: strings.threads,
                value: integer.format(latest?.threads ?? 0),
              },
              {
                label: strings.processes,
                value: integer.format(latest?.processes ?? 0),
              },
            ],
          ]}
        />
      );
      break;
    }
    case "memory": {
      value = memory(latest === undefined ? 0 : used(latest.memory));
      detail = compact ? undefined : `/ ${memory(latest?.memory.total ?? 0)}`;
      chart = (
        <Chart
          marks={[
            {
              type: "rectangle",
              data: history.map((point, index) => ({
                xStart:
                  index === 0
                    ? point.x - intervalMs / 1000
                    : history[index - 1].x,
                xEnd: point.x,
                yStart: 0,
                yEnd: point.memory.pressure,
                color: pressureColors[point.memory.level],
              })),
              opacity: 0.8,
            },
          ]}
          legend="hidden"
          xScale={xScale}
          yScale={{ domain: [0, 100] }}
          {...axes(percentAxis)}
          modifiers={[size]}
        />
      );
      const amount = (bytes: number | undefined) =>
        bytes === undefined ? "" : memory(bytes);
      footer = (
        <Stats
          columns={[
            [
              { label: strings.app, value: amount(latest?.memory.app) },
              { label: strings.wired, value: amount(latest?.memory.wired) },
            ],
            [
              {
                label: strings.compressed,
                value: amount(latest?.memory.compressed),
              },
              { label: strings.cached, value: amount(latest?.memory.cached) },
            ],
          ]}
        />
      );
      break;
    }
    default: {
      const series = kind === "disk" ? diskSeries : networkSeries;
      const limit = ceiling(
        history.reduce(
          (peak, point) =>
            Math.max(peak, ...series.map(({ value }) => value(point) ?? 0)),
          0,
        ),
        10_000,
      );
      const points = seriesData(history, series);
      value = display(
        series.reduce<number | undefined>((sum, { value }) => {
          const part = latest && value(latest);
          return sum === undefined || part === undefined
            ? undefined
            : sum + part;
        }, 0),
        rate,
      );
      chart = (
        <Chart
          marks={[
            {
              type: "area",
              data: points,
              stacking: "unstacked",
              interpolation: "monotone",
              opacity: 0.16,
            },
            {
              type: "line",
              data: points,
              interpolation: "monotone",
              lineStyle: { width: 1.5 },
            },
          ]}
          seriesColors={seriesColors(series)}
          legend="hidden"
          xScale={xScale}
          yScale={{ domain: [0, limit] }}
          {...axes(halves(limit, (value) => `${scaled(value, 1000, round)}/s`))}
          modifiers={[size]}
        />
      );
      footer = (
        <Stats
          columns={[
            series.map(({ label, color, value, total }) => ({
              label,
              color,
              value: display(latest && value(latest), rate),
              detail:
                latest === undefined || total === undefined
                  ? undefined
                  : data(total(latest)),
            })),
          ]}
        />
      );
    }
  }
  const panel = (
    <VStack
      alignment="leading"
      spacing={compact ? 8 : 10}
      modifiers={
        surface === undefined
          ? []
          : [
              padding({ all: compact ? 12 : 14 }),
              background(
                surface,
                shapes.roundedRectangle({ cornerRadius: 18 }),
              ),
              contentShape(shapes.rectangle()),
            ]
      }
    >
      <HStack alignment="firstTextBaseline">
        <Text
          modifiers={[
            font({
              textStyle: compact ? "subheadline" : "headline",
              weight: "semibold",
            }),
            secondary,
            lineLimit(1),
          ]}
        >
          {strings[kind]}
        </Text>
        <Spacer />
        <Text
          modifiers={[
            font({
              textStyle: compact ? "subheadline" : "title3",
              weight: "semibold",
              design: "rounded",
            }),
            monospacedDigit(),
            lineLimit(1),
            contentTransition("numericText"),
          ]}
        >
          {value}
        </Text>
        {detail === undefined ? undefined : (
          <Text
            modifiers={[
              font({ textStyle: "subheadline", design: "rounded" }),
              monospacedDigit(),
              secondary,
              lineLimit(1),
            ]}
          >
            {detail}
          </Text>
        )}
      </HStack>
      {chart}
      {compact ? undefined : footer}
    </VStack>
  );
  return onPress === undefined ? (
    panel
  ) : (
    <Button onPress={onPress} modifiers={[buttonStyle("plain")]}>
      {panel}
    </Button>
  );
}

interface Stat {
  readonly label: string;
  readonly value: string;
  readonly color?: ColorValue;
  readonly detail?: string;
}

function Stats({ columns }: { columns: readonly (readonly Stat[])[] }) {
  const caption = font({ textStyle: "caption" });
  return (
    <HStack alignment="top" spacing={18}>
      {columns.map((stats, index) => (
        <VStack
          key={index}
          spacing={4}
          modifiers={[frame({ maxWidth: Infinity })]}
        >
          {stats.map((stat) => (
            <HStack key={stat.label} spacing={5}>
              {stat.color === undefined ? undefined : (
                <Circle
                  modifiers={[
                    foregroundStyle(stat.color),
                    frame({ width: 7, height: 7 }),
                  ]}
                />
              )}
              <Text modifiers={[caption, secondary, lineLimit(1)]}>
                {stat.label}
              </Text>
              <Spacer />
              <Text modifiers={[caption, monospacedDigit(), lineLimit(1)]}>
                {stat.value}
              </Text>
              {stat.detail === undefined ? undefined : (
                <Text
                  modifiers={[
                    caption,
                    monospacedDigit(),
                    secondary,
                    lineLimit(1),
                    frame({ width: 62, alignment: "trailing" }),
                  ]}
                >
                  {stat.detail}
                </Text>
              )}
            </HStack>
          ))}
        </VStack>
      ))}
    </HStack>
  );
}

function Detail({ label, children }: { label: string; children: string }) {
  return (
    <LabeledContent label={label}>
      <Text modifiers={[monospacedDigit()]}>{children}</Text>
    </LabeledContent>
  );
}

function Trend({
  title,
  value,
  points,
  limit,
  label,
  color,
}: {
  title: string;
  value: string;
  points: readonly { readonly x: number; readonly y: number }[];
  limit: number;
  label: (value: number) => string;
  color: ColorValue;
}) {
  return (
    <VStack
      alignment="leading"
      spacing={8}
      modifiers={[
        padding({ all: 12 }),
        background(
          PlatformColor("secondarySystemGroupedBackground"),
          shapes.roundedRectangle({ cornerRadius: 18 }),
        ),
      ]}
    >
      <HStack alignment="firstTextBaseline">
        <Text
          modifiers={[
            font({ textStyle: "subheadline", weight: "semibold" }),
            secondary,
          ]}
        >
          {title}
        </Text>
        <Spacer />
        <Text
          modifiers={[
            font({
              textStyle: "subheadline",
              weight: "semibold",
              design: "rounded",
            }),
            monospacedDigit(),
          ]}
        >
          {value}
        </Text>
      </HStack>
      <Chart
        marks={trend(points, color)}
        xScale={timeScale(points)}
        yScale={{ domain: [0, limit] }}
        xAxis="hidden"
        yAxis={halves(limit, label)}
        modifiers={[frame({ height: 72 })]}
      />
    </VStack>
  );
}

function Process({
  row,
  samples,
  failure,
  onForceQuit,
}: {
  row: Row;
  samples: readonly Usage[];
  failure?: string;
  onForceQuit: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const { process } = row;
  const latest = samples.at(-1)?.time ?? 0;
  const past = samples.slice(-historyLength).flatMap((sample) => {
    const usage = sample.processes.find((it) => it.pid === row.pid);
    return usage === undefined
      ? []
      : [
          {
            x: (sample.time - latest) / 1000,
            cpu: usage.cpuUsage,
            memory: usage.physFootprint ?? 0,
          },
        ];
  });
  const clear = [
    listRowBackground("clear"),
    listRowInsets({ top: 0, leading: 0, bottom: 0, trailing: 0 }),
  ];
  return (
    <List modifiers={[listSectionSpacing(16)]}>
      <Section modifiers={clear}>
        <HStack spacing={12} modifiers={[padding({ horizontal: 4 })]}>
          <Icon uri={row.icon} size={44} />
          <VStack alignment="leading" spacing={2}>
            <Text
              modifiers={[
                font({ textStyle: "title3", weight: "semibold" }),
                lineLimit(1),
                truncationMode("middle"),
              ]}
            >
              {row.name}
            </Text>
            <Text
              modifiers={[
                font({ textStyle: "subheadline" }),
                secondary,
                monospacedDigit(),
                lineLimit(1),
              ]}
            >
              {[row.owner, `${strings.processId} ${process.pid}`]
                .filter((part) => part !== undefined)
                .join(" · ")}
            </Text>
          </VStack>
          <Spacer />
        </HStack>
      </Section>
      <Section modifiers={clear}>
        <HStack spacing={12}>
          <Trend
            title={strings.cpu}
            value={display(process.cpuUsage, (cpu) => share.format(cpu / 100))}
            points={past.flatMap(({ x, cpu }) =>
              cpu === undefined ? [] : [{ x, y: cpu }],
            )}
            limit={ceiling(
              past.reduce((peak, { cpu }) => Math.max(peak, cpu ?? 0), 0),
              10,
            )}
            label={(value) => percent.format(value / 100)}
            color={blue}
          />
          <Trend
            title={strings.memory}
            value={memory(process.physFootprint ?? 0)}
            points={past.map(({ x, memory }) => ({ x, y: memory }))}
            limit={
              2 **
              Math.ceil(
                Math.log2(
                  past.reduce(
                    (peak, { memory }) => Math.max(peak, memory),
                    2 ** 20,
                  ),
                ),
              )
            }
            label={(value) => scaled(value, 1024, round)}
            color={purple}
          />
        </HStack>
      </Section>
      <Section>
        <Detail label={strings.cpuTime}>
          {elapsed(
            ((process.cpuTotalUser ?? 0) + (process.cpuTotalSystem ?? 0)) / 1e6,
          )}
        </Detail>
        <Detail label={strings.threads}>
          {integer.format(process.threadCount ?? 0)}
        </Detail>
        <Detail label={strings.energyImpact}>
          {display(process.powerScore, decimal.format)}
        </Detail>
        <Detail label={strings.dataRead}>
          {data(process.diskBytesRead ?? 0)}
        </Detail>
        <Detail label={strings.dataWritten}>
          {data(process.diskBytesWritten ?? 0)}
        </Detail>
        <Detail label={strings.userId}>{String(process.uid ?? "")}</Detail>
      </Section>
      <Section
        footer={
          <Text modifiers={[textSelection(true)]}>
            {[process.bundleId, process.executablePath, failure]
              .filter((line) => line !== undefined)
              .join("\n")}
          </Text>
        }
      >
        <Alert
          title={strings.forceQuitMessage.replace("{name}", row.name)}
          isPresented={confirming}
          onIsPresentedChange={setConfirming}
        >
          <Alert.Trigger>
            <Button
              label={strings.forceQuit}
              role="destructive"
              onPress={() => setConfirming(true)}
            />
          </Alert.Trigger>
          <Alert.Actions>
            <Button
              label={strings.forceQuit}
              role="destructive"
              onPress={onForceQuit}
            />
            <Button label={strings.cancel} role="cancel" />
          </Alert.Actions>
        </Alert>
      </Section>
    </List>
  );
}
