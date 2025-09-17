export interface OrderFields {
  destination: string;
  itemName: string;
  trackingId: string;
  truckNumber: string;
  shipDate: string;
  expectedDeparture: string;
  origin: string;
}

export interface StorageRecord extends OrderFields {
  id: string;
}

export interface ScannedOrderRecord extends OrderFields {
  scannedAt: string;
}

export interface CurrentScanRecord {
  raw: ScannedOrderRecord;
  resolved: OrderFields;
  bookingMatch: boolean;
  bookingMessage: string;
  storageMatch: boolean;
  storageMessage: string;
  storageRowId?: string | null;
  lastRefreshed: string | null;
}

export const ORDER_FIELD_KEYS = [
  'destination',
  'itemName',
  'trackingId',
  'truckNumber',
  'shipDate',
  'expectedDeparture',
  'origin',
] as const;

export type OrderFieldKey = (typeof ORDER_FIELD_KEYS)[number];

export const ORDER_FIELD_LABELS: Record<OrderFieldKey, string> = {
  destination: 'Destination (Rack Number)',
  itemName: 'Item Name',
  trackingId: 'Tracking ID',
  truckNumber: 'Truck Number',
  shipDate: 'Ship Date',
  expectedDeparture: 'Expected Departure Time',
  origin: 'Origin',
};
