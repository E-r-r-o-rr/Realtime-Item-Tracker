export type MapPoint = {
  id: number;
  label: string;
  synonyms: string[];
  xPx: number;
  yPx: number;
  lat: number;
  lon: number;
  createdAt: string;
  updatedAt: string;
};

export type FloorMap = {
  id: number;
  name: string;
  floor: string | null;
  imageUrl: string;
  width: number;
  height: number;
  georefOriginLat: number | null;
  georefOriginLon: number | null;
  georefRotationDeg: number;
  georefScaleMPx: number;
  createdAt: string;
  updatedAt: string;
  points: MapPoint[];
};
