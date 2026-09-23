export type DiagramVariant = 'db-push' | 'reset-conflict' | 'supabee-reset';
export type StepKind = 'migration' | 'new-migration' | 'seeding';

export interface DiagramStep {
  kind: StepKind;
  label: string;
  marker: string;
  y: number;
  group: number;
  failed?: boolean;
}

export interface DiagramConfig {
  title: string;
  description: string;
  height: number;
  highlight: Array<{ label: string; y: number; height: number; groups: number[] }>;
  steps: DiagramStep[];
  status: 'conflict' | 'success';
}

const migrations = (group = 0): DiagramStep[] => [
  { kind: 'migration', label: 'Migration #1', marker: '1', y: 54, group },
  { kind: 'migration', label: 'Migration #2', marker: '2', y: 138, group },
  { kind: 'migration', label: 'Migration #3', marker: '3', y: 222, group },
];

export const diagrams: Record<DiagramVariant, DiagramConfig> = {
  'reset-conflict': {
    title: 'Supabase db reset conflict',
    description: 'The schema dump is restored, Migration 4 changes it, and the older data dump then conflicts with that changed schema.',
    height: 650,
    highlight: [
      { label: 'Schema dump', y: 20, height: 296, groups: [0] },
      { label: 'Data dump', y: 500, height: 126, groups: [2] },
    ],
    steps: [
      ...migrations(),
      { kind: 'new-migration', label: 'New Migration #4', marker: '4', y: 350, group: 1 },
      { kind: 'seeding', label: 'Seeding', marker: '+', y: 534, group: 2, failed: true },
    ],
    status: 'conflict',
  },
  'db-push': {
    title: 'Supabase db push',
    description: 'Migrations 1 through 3 and the existing data form the live database before Migration 4 is applied successfully.',
    height: 560,
    highlight: [{ label: 'Live database', y: 20, height: 378, groups: [0, 1] }],
    steps: [
      ...migrations(),
      { kind: 'seeding', label: 'Seeding', marker: '+', y: 306, group: 1 },
      { kind: 'new-migration', label: 'New Migration #4', marker: '4', y: 478, group: 2 },
    ],
    status: 'success',
  },
  'supabee-reset': {
    title: 'Supabee db reset',
    description: 'Supabee restores the schema dump, loads the data dump, and only then applies Migration 4 successfully.',
    height: 630,
    highlight: [
      { label: 'Schema dump', y: 20, height: 296, groups: [0] },
      { label: 'Data dump', y: 340, height: 126, groups: [1] },
    ],
    steps: [
      ...migrations(),
      { kind: 'seeding', label: 'Seeding', marker: '+', y: 374, group: 1 },
      { kind: 'new-migration', label: 'New Migration #4', marker: '4', y: 546, group: 2 },
    ],
    status: 'success',
  },
};

export const timing = { groupPause: 820, stepGap: 190, statusPause: 620 };
