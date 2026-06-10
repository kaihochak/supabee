import process from 'node:process';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  white: '\x1b[37m',
};
type ColorName = keyof typeof COLORS;

function paint(text: string, color: ColorName) {
  if (!useColor) return text;
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

function style(text: string, ...styles: ColorName[]) {
  if (!useColor) return text;
  return `${styles.map((name) => COLORS[name]).join('')}${text}${COLORS.reset}`;
}

function formatLabel(label: string, color: ColorName) {
  return style(`[${label}]`, 'bold', color);
}

function line(char = '-', width = 54) {
  return char.repeat(width);
}

export function section(title: string) {
  const header = style(` ${title} `, 'bold', 'white');
  if (!useColor) {
    return `\n${line('=')}\n${header}\n${line('=')}`;
  }
  return `\n${paint(line('-'), 'dim')}\n${header}\n${paint(line('-'), 'dim')}`;
}

export function sectionWithNote(title: string, note: string) {
  const header = style(` ${title} `, 'bold', 'white');
  if (!useColor) {
    return `\n${line('=')}\n${header}\n${note}\n${line('=')}`;
  }
  return `\n${paint(line('-'), 'dim')}\n${header}\n${note}\n${paint(line('-'), 'dim')}`;
}

export function info(message: string) {
  return useColor ? paint(message, 'dim') : message;
}

export function ok(message: string) {
  return `${formatLabel('SUCCESS', 'green')} ${message}`;
}

export function warn(message: string) {
  return `${formatLabel('WARN', 'yellow')} ${message}`;
}

export function error(message: string) {
  return `${formatLabel('ERROR', 'red')} ${message}`;
}

export function title(message: string) {
  return useColor ? style(`[${message}]`, 'bold', 'cyan') : `[${message}]`;
}

export function pass(message: string) {
  return useColor ? `${paint('✓', 'green')} ${message}` : `✓ ${message}`;
}

export function fail(message: string) {
  return useColor ? `${paint('x', 'red')} ${message}` : `x ${message}`;
}

export function note(message: string) {
  return `${formatLabel('NOTE', 'yellow')} ${message}`;
}

export function recommended(message: string) {
  return useColor ? paint(message, 'yellow') : message;
}

export function diffRemove(message: string) {
  return useColor ? `${paint('-', 'red')} ${paint(message, 'red')}` : `- ${message}`;
}

export function diffAdd(message: string) {
  return useColor ? `${paint('+', 'green')} ${paint(message, 'green')}` : `+ ${message}`;
}

export function heading(message: string) {
  return useColor ? style(message, 'bold', 'cyan') : message;
}

export function hr(width = 60) {
  return useColor ? paint(line('─', width), 'dim') : line('─', width);
}

export function green(message: string) {
  return paint(message, 'green');
}

export function red(message: string) {
  return paint(message, 'red');
}
