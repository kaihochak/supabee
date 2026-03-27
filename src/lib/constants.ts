// @ts-nocheck
export const DEFAULT_TOOL_CONFIG_PATH = 'supabase-splitter.config.json';

export const DEFAULTS = {
  schema: {
    input: 'supabase/schemas/prod-schemas.sql',
    output: 'supabase/schemas/split',
    reconstructed: 'supabase/schemas/reconstructed-schemas.sql',
    keepFiles: [],
  },
  data: {
    input: 'supabase/seeds/prod-data.sql',
    output: 'supabase/seeds/split',
    reconstructed: 'supabase/seeds/reconstructed-data.sql',
    maxLinesPerFile: 2000,
    maxStatementsPerFile: 20,
    maxRowsPerInsert: 200,
    tableRules: {},
    keepFiles: [],
    ignoreInReconstruct: [],
  },
};
