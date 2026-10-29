export class SqlStatementBoundary {
  private quote: "'" | '"' | null = null;
  private escapeString = false;
  private dollarQuote: string | null = null;
  private blockDepth = 0;

  consumeLine(line: string): boolean {
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      const next = line[i + 1];

      if (this.blockDepth > 0) {
        if (char === '/' && next === '*') {
          this.blockDepth += 1;
          i += 1;
        } else if (char === '*' && next === '/') {
          this.blockDepth -= 1;
          i += 1;
        }
        continue;
      }

      if (this.dollarQuote !== null) {
        if (line.startsWith(this.dollarQuote, i)) {
          i += this.dollarQuote.length - 1;
          this.dollarQuote = null;
        }
        continue;
      }

      if (this.quote !== null) {
        if (this.escapeString && char === '\\') {
          i += 1; // E'...' escapes the next character, including another backslash.
        } else if (char === this.quote) {
          if (next === this.quote) i += 1; // SQL doubles quotes to escape them.
          else this.quote = null;
        }
        continue;
      }

      if (char === '-' && next === '-') break;
      if (char === '/' && next === '*') {
        this.blockDepth = 1;
        i += 1;
      } else if (char === "'" || char === '"') {
        this.quote = char;
        // Dumps use standard-conforming strings; only E'...' treats backslashes as escapes.
        this.escapeString = char === "'" && /[eE]/.test(line[i - 1] ?? '') &&
          !/[\w$\u0080-\uffff]/.test(line[i - 2] ?? '');
      } else if (char === '$' && !/[\w$\u0080-\uffff]/.test(line[i - 1] ?? '')) {
        const tag = line.slice(i).match(/^\$(?:[A-Za-z_\u0080-\uffff][\w\u0080-\uffff]*)?\$/)?.[0];
        if (tag) {
          this.dollarQuote = tag;
          i += tag.length - 1;
        }
      } else if (char === ';') {
        return true;
      }
    }
    return false;
  }
}
