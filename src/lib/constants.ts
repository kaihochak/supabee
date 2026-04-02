export const DEFAULT_TOOL_CONFIG_PATH = 'supabee.config.json';
export const LEGACY_TOOL_CONFIG_PATH = 'supabase-splitter.config.json';

export type DataTableRule = {
  maxLinesPerFile?: number;
  maxStatementsPerFile?: number;
  maxRowsPerInsert?: number;
  skip?: boolean;
};

export type ToolConfig = {
  schema?: {
    input?: string;
    output?: string;
    reconstructed?: string;
    backup?: boolean;
    keepFiles?: string[];
  };
  data?: {
    input?: string;
    output?: string;
    reconstructed?: string;
    backup?: boolean;
    maxLinesPerFile?: number;
    maxStatementsPerFile?: number;
    maxRowsPerInsert?: number;
    tableRules?: Record<string, DataTableRule>;
    keepFiles?: string[];
    ignoreInReconstruct?: string[];
  };
  init?: {
    seedSqlPaths?: string[];
  };
};

export const DEFAULTS = {
  schema: {
    input: 'supabase/schemas/prod-schemas.sql',
    output: 'supabase/schemas/split',
    reconstructed: 'supabase/schemas/reconstructed-schemas.sql',
    backup: false,
    keepFiles: [],
  },
  data: {
    input: 'supabase/seeds/prod-data.sql',
    output: 'supabase/seeds/split',
    reconstructed: 'supabase/seeds/reconstructed-data.sql',
    backup: false,
    maxLinesPerFile: 2000,
    maxStatementsPerFile: 20,
    maxRowsPerInsert: 200,
    tableRules: {},
    keepFiles: [],
    ignoreInReconstruct: [],
  },
};
