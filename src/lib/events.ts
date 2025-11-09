export type StorageEventType = "storage.created" | "storage.updated";

export interface StorageEventPayload {
  trackingId: string;
  destination: string;
  itemName: string;
  originLocation?: string;
  booked?: number;
  [key: string]: unknown;
}

export interface StorageEvent {
  type: StorageEventType;
  timestamp: string;
  payload: StorageEventPayload;
  changes?: Partial<StorageEventPayload>;
}

type EventConsumer = (event: StorageEvent) => void | Promise<void>;

const DEFAULT_CONSUMER: EventConsumer = async (event) => {
  console.info(`[events] ${event.type}`, event);
};

const GLOBAL_KEY = "__REALTIME_ITEM_TRACKER_EVENT_CONSUMER__" as const;

type EventGlobal = typeof globalThis & {
  [GLOBAL_KEY]?: { consumer: EventConsumer };
};

const globalTarget = globalThis as EventGlobal;
if (!globalTarget[GLOBAL_KEY]) {
  globalTarget[GLOBAL_KEY] = { consumer: DEFAULT_CONSUMER };
}

const getState = () => globalTarget[GLOBAL_KEY]!;

export const setEventConsumer = (consumer: EventConsumer | null | undefined) => {
  getState().consumer = consumer ?? DEFAULT_CONSUMER;
};

export const resetEventConsumer = () => {
  getState().consumer = DEFAULT_CONSUMER;
};

const dispatch = async (event: StorageEvent) => {
  await getState().consumer(event);
};

export const publishStorageCreated = async (payload: StorageEventPayload) => {
  const event: StorageEvent = {
    type: "storage.created",
    timestamp: new Date().toISOString(),
    payload: { ...payload },
  };
  await dispatch(event);
};

export const publishStorageUpdated = async (
  payload: StorageEventPayload,
  changes?: Partial<StorageEventPayload>,
) => {
  const event: StorageEvent = {
    type: "storage.updated",
    timestamp: new Date().toISOString(),
    payload: { ...payload },
    changes: changes ? { ...changes } : undefined,
  };
  await dispatch(event);
};
