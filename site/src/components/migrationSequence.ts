export type DiagramVariant = 'db-push' | 'reset-conflict' | 'supabee-reset' | 'hero';
export type StepKind = 'migration' | 'new-migration' | 'seeding';

export interface DiagramStep {
  kind: StepKind;
  label: string;
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

const layout = {
  oldMigrations: [54, 126],
  conflictNewMigrations: [266, 338],
  conflictSeed: 534,
  liveSeed: 222,
  correctedSeed: 290,
  correctedNewMigrations: [462, 534],
} as const;

const migrationSteps = (
  kind: Extract<StepKind, 'migration' | 'new-migration'>,
  firstNumber: number,
  positions: readonly number[],
  group: number,
): DiagramStep[] => positions.map((y, index) => {
  const number = firstNumber + index;
  return {
    kind,
    label: `${kind === 'new-migration' ? 'New Migration' : 'Migration'} #${number}`,
    y,
    group,
  };
});

const oldMigrations = (group = 0) => migrationSteps('migration', 1, layout.oldMigrations, group);
const newMigrations = (positions: readonly number[], group: number) => migrationSteps('new-migration', 3, positions, group);

const resetConflict: DiagramConfig = {
  title: 'supabase db reset',
  description: 'The schema dump restores Migrations 1 and 2, new Migrations 3 and 4 change it, and the older data dump then conflicts with that changed schema.',
  height: 650,
  highlight: [
    { label: 'Schema dump', y: 20, height: 194, groups: [0] },
    { label: 'Data dump', y: 500, height: 108, groups: [2] },
  ],
  steps: [
    ...oldMigrations(),
    ...newMigrations(layout.conflictNewMigrations, 1),
    { kind: 'seeding', label: 'Seeding', y: layout.conflictSeed, group: 2, failed: true },
  ],
  status: 'conflict',
};

export const diagrams: Record<DiagramVariant, DiagramConfig> = {
  'reset-conflict': resetConflict,
  'db-push': {
    title: 'supabase db push',
    description: 'Migrations 1 and 2 and the existing data form the live database before new Migrations 3 and 4 are applied successfully.',
    height: 562,
    highlight: [{ label: 'Live database', y: 20, height: 276, groups: [0, 1] }],
    steps: [
      ...oldMigrations(),
      { kind: 'seeding', label: 'Seeding', y: layout.liveSeed, group: 1 },
      ...newMigrations([394, 466], 2),
    ],
    status: 'success',
  },
  'supabee-reset': {
    title: 'supabee db reset',
    description: 'Supabee restores Migrations 1 and 2 from the schema dump, loads the data dump, and only then applies new Migrations 3 and 4 successfully.',
    height: 630,
    highlight: [
      { label: 'Schema dump', y: 20, height: 194, groups: [0] },
      { label: 'Data dump', y: 256, height: 108, groups: [1] },
    ],
    steps: [
      ...oldMigrations(),
      { kind: 'seeding', label: 'Seeding', y: layout.correctedSeed, group: 1 },
      ...newMigrations(layout.correctedNewMigrations, 2),
    ],
    status: 'success',
  },
  hero: {
    ...resetConflict,
    title: 'Supabase db reset corrected by Supabee',
    description: 'The conflicting reset order is shown first, then the data dump moves before new Migrations 3 and 4 and the reset succeeds.',
    loopTitle: { initial: 'supabase db reset', corrected: 'supabee db reset' },
    extraConnectors: [
      { id: 'corrected-connector-0', path: 'M480 198V290' },
      { id: 'corrected-connector-1', path: 'M480 348V462' },
      { id: 'corrected-connector-2', path: 'M480 522V546' },
    ],
    phases: [
      {
        actions: [{ type: 'strike', target: 'loop-title' }],
        waitAfter: 450,
      },
      {
        actions: [{ type: 'hide', targets: ['step-2', 'step-3', 'connector-1', 'connector-2', 'connector-3', 'status'] }],
        waitAfter: 450,
      },
      {
        actions: [{ type: 'label', target: 'loop-title', text: 'supabee db reset' }],
        waitAfter: 450,
      },
      {
        actions: [
          { type: 'move', targets: ['highlight-1', 'step-4'], y: -244 },
          { type: 'seed-success', target: 'step-4' },
          { type: 'show', targets: ['corrected-connector-0'] },
        ],
        waitAfter: 600,
      },
      {
        actions: [
          { type: 'move', targets: ['step-2'], y: 196, show: true },
          { type: 'show', targets: ['corrected-connector-1'] },
        ],
        waitAfter: 300,
      },
      {
        actions: [
          { type: 'move', targets: ['step-3'], y: 196, show: true },
          { type: 'show', targets: ['corrected-connector-2'] },
        ],
        waitAfter: 550,
      },
      {
        actions: [{ type: 'status', target: 'status', kind: 'success', y: -33 }],
        waitAfter: 2200,
      },
    ],
  },
};

export const timing = { groupPause: 900, stepGap: 240, statusGap: 320 };
