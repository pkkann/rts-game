import type { BuildingType } from '../types';

export interface BuildingDef {
  name: string;
  w: number;
  h: number;
  hp: number;
  cost: number;
  buildTicks: number;
  /** Positive = produces power, negative = consumes. */
  power: number;
  sight: number;
  prereq: BuildingType[];
  buildable: boolean;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  cy: { name: 'Construction Yard', w: 3, h: 3, hp: 1500, cost: 0, buildTicks: 0, power: 15, sight: 6, prereq: [], buildable: false },
  power: { name: 'Power Plant', w: 2, h: 2, hp: 400, cost: 300, buildTicks: 200, power: 100, sight: 4, prereq: [], buildable: true },
  refinery: { name: 'Refinery', w: 3, h: 2, hp: 900, cost: 1500, buildTicks: 300, power: -40, sight: 4, prereq: ['power'], buildable: true },
  barracks: { name: 'Barracks', w: 2, h: 2, hp: 500, cost: 300, buildTicks: 200, power: -20, sight: 4, prereq: ['power'], buildable: true },
  factory: { name: 'War Factory', w: 3, h: 3, hp: 1000, cost: 2000, buildTicks: 400, power: -30, sight: 4, prereq: ['refinery'], buildable: true },
};

/** Max gap in tiles between a new building and an existing own building. */
export const BUILD_GAP = 2;
