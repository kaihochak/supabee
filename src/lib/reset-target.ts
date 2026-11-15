import { runCommandCapture } from './subprocess.js';
import { resolveLinkedProject, validateProjectRef } from './linked-project.js';
import { validateRemoteDbUrl } from './remote-db-url.js';

const PROJECT_REF = /^[a-z]{20}$/;

export async function resolveResetRemote(remote: boolean | string): Promise<{
  dbUrl?: string; projectRef?: string; label: string; targetArgs: string[];
}> {
  if (typeof remote === 'string' && !remote.trim()) throw new Error('--remote requires a non-empty target when a value is supplied.');
  if (typeof remote === 'string' && /^postgres(?:ql)?:\/\//.test(remote)) {
    const dbUrl = validateRemoteDbUrl(remote);
    return { dbUrl, label: `remote database at ${new URL(dbUrl).hostname}`, targetArgs: [`--remote=${dbUrl}`] };
  }

  let ref: string;
  if (typeof remote === 'string' && PROJECT_REF.test(remote)) {
    ref = remote;
  } else {
    const { projectRef: parent } = await resolveLinkedProject();
    if (remote === true) ref = parent;
    else {
      const { stdout } = await runCommandCapture('supabase', ['branches', 'list', `--remote=${parent}`, '--output-format', 'json']);
      const branches: unknown = JSON.parse(stdout);
      if (!Array.isArray(branches)) throw new Error('Could not read Supabase branch list.');
      const matches = branches.filter((branch) => branch.name === remote || branch.id === remote);
      if (matches.length !== 1) throw new Error('Remote branch was not found uniquely in the linked project.');
      ref = validateProjectRef(matches[0].project_ref);
    }
  }
  return { projectRef: ref, label: `remote project ${ref}`, targetArgs: [`--remote=${ref}`] };
}
