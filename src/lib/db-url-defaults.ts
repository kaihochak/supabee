export async function confirmDbUrlDefaults(
  value: string,
  ask: (question: string) => Promise<string>,
): Promise<string> {
  const suggested = new URL(value);
  const additions: string[] = [];
  if (!suggested.pathname || suggested.pathname === '/') {
    suggested.pathname = '/postgres';
    additions.push('database /postgres');
  }
  if (!suggested.searchParams.has('sslmode')) {
    suggested.searchParams.append('sslmode', 'require');
    additions.push('sslmode=require');
  }
  if (additions.length === 0) return value;

  const question = `Add ${additions.join(' and ')}? [Y/n] `;
  while (true) {
    const answer = (await ask(question)).trim().toLowerCase();
    if (answer === '' || answer === 'y' || answer === 'yes') return suggested.toString();
    if (answer === 'n' || answer === 'no') return value;
  }
}
