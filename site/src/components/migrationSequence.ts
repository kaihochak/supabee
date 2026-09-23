export type DiagramVariant = 'db-push' | 'reset-conflict' | 'supabee-reset' | 'hero';
export type StepKind = 'migration' | 'new-migration' | 'seeding';

export interface DiagramStep {
  kind: StepKind;
  label: string;
  marker: string;
  y: number;
  group: number;
  failed?: boolean;
}

type TransitionAction =
  | { type: 'hide' | 'show'; targets: string[] }
  | { type: 'move'; targets: string[]; y: number; show?: boolean }
  | { type: 'seed-success'; target: string }
  | { type: 'status'; target: string; kind: 'success'; y: number }
  | { type: 'strike'; target: string }
  | { type: 'label'; target: string; text: string };

interface TransitionPhase {
  actions: TransitionAction[];
  waitAfter: number;
}

export interface DiagramConfig {
  title: string;
  description: string;
  height: number;
  highlight: Array<{ label: string; y: number; height: number; groups: number[] }>;
  steps: DiagramStep[];
  status: 'conflict' | 'success';
  loopTitle?: { initial: string; corrected: string };
  extraConnectors?: Array<{ id: string; path: string }>;
  phases?: TransitionPhase[];
}

const migrations = (group = 0): DiagramStep[] => [
  { kind: 'migration', label: 'Migration #1', marker: '1', y: 54, group },
  { kind: 'migration', label: 'Migration #2', marker: '2', y: 138, group },
  { kind: 'migration', label: 'Migration #3', marker: '3', y: 222, group },
];

const resetConflict: DiagramConfig = {
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
};

export const diagrams: Record<DiagramVariant, DiagramConfig> = {
  'reset-conflict': resetConflict,
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
  hero: {
    ...resetConflict,
    title: 'Supabase db reset corrected by Supabee',
    description: 'The conflicting reset order is shown first, then the data dump moves before Migration 4 and the reset succeeds.',
    loopTitle: { initial: 'supabase db reset', corrected: 'supabee db reset' },
    extraConnectors: [
      { id: 'corrected-connector-0', path: 'M480 282V374' },
      { id: 'corrected-connector-1', path: 'M480 432V546' },
    ],
    phases: [
      {
        actions: [{ type: 'strike', target: 'loop-title' }],
        waitAfter: 350,
      },
      {
        actions: [{ type: 'hide', targets: ['step-3', 'connector-2', 'connector-3', 'status'] }],
        waitAfter: 350,
      },
      {
        actions: [{ type: 'label', target: 'loop-title', text: 'supabee db reset' }],
        waitAfter: 350,
      },
      {
        actions: [
          { type: 'move', targets: ['highlight-1', 'step-4'], y: -160 },
          { type: 'seed-success', target: 'step-4' },
          { type: 'show', targets: ['corrected-connector-0'] },
        ],
        waitAfter: 500,
      },
      {
        actions: [
          { type: 'move', targets: ['step-3'], y: 196, show: true },
          { type: 'show', targets: ['corrected-connector-1'] },
        ],
        waitAfter: 450,
      },
      {
        actions: [{ type: 'status', target: 'status', kind: 'success', y: 51 }],
        waitAfter: 2200,
      },
    ],
  },
};

export const timing = { groupPause: 820, stepGap: 190, statusPause: 620 };
