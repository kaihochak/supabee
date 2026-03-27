// @ts-nocheck
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

function paint(text, color) {
  if (!useColor) return text;
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

function style(text, ...styles) {
  if (!useColor) return text;
  return `${styles.map((name) => COLORS[name]).join('')}${text}${COLORS.reset}`;
}

function formatLabel(label, color) {
  return style(`[${label}]`, 'bold', color);
}

function line(char = '-', width = 54) {
  return char.repeat(width);
}

export function section(title) {
  const header = style(` ${title} `, 'bold', 'white');
  if (!useColor) {
    return `\n${line('=')}\n${header}\n${line('=')}`;
  }
  return `\n${paint(line('-'), 'dim')}\n${header}\n${paint(line('-'), 'dim')}`;
}

export function sectionWithNote(title, note) {
  const header = style(` ${title} `, 'bold', 'white');
  if (!useColor) {
    return `\n${line('=')}\n${header}\n${note}\n${line('=')}`;
  }
  return `\n${paint(line('-'), 'dim')}\n${header}\n${note}\n${paint(line('-'), 'dim')}`;
}

export function info(message) {
  return useColor ? paint(message, 'dim') : message;
}

export function ok(message) {
  return `${formatLabel('SUCCESS', 'green')} ${message}`;
}

export function warn(message) {
  return `${formatLabel('WARN', 'yellow')} ${message}`;
}

export function error(message) {
  return `${formatLabel('ERROR', 'red')} ${message}`;
}

export function title(message) {
  return useColor ? style(`[${message}]`, 'bold', 'cyan') : `[${message}]`;
}

export function pass(message) {
  return useColor ? `${paint('✓', 'green')} ${message}` : `✓ ${message}`;
}

export function fail(message) {
  return useColor ? `${paint('x', 'red')} ${message}` : `x ${message}`;
}

export function note(message) {
  return `${formatLabel('NOTE', 'yellow')} ${message}`;
}

export function recommended(message) {
  return useColor ? paint(message, 'yellow') : message;
}

export function diffRemove(message) {
  return useColor ? `${paint('-', 'red')} ${paint(message, 'red')}` : `- ${message}`;
}

export function diffAdd(message) {
  return useColor ? `${paint('+', 'green')} ${paint(message, 'green')}` : `+ ${message}`;
}
