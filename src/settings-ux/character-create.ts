import { openRosterCommand, type RosterCommandActions } from './roster-command';

/**
 * 「LLM한테 시키기」 opens the roster command over the whole list in view: it can
 * add (through character creation, as before), edit and delete, with a preview.
 * The selection bar opens the same dialog for the picked characters only.
 */
export function bindCharacterCreate(): void {
  const button = document.getElementById('nx-char-create-llm');
  if (!button || button.dataset.nxBound) return;
  button.dataset.nxBound = '1';
  button.addEventListener('click', () => {
    const actions = Reflect.get(globalThis, '__OMNI_SETTINGS_ACTIONS__') as RosterCommandActions | undefined;
    if (!actions?.characterTarget || !actions.request) return;
    openRosterCommand(actions, characterListScope(actions), [], []);
  });
}

/** The roster the character tab shows: the global one, or this bot's. */
export function characterListScope(actions: RosterCommandActions): string {
  return document.getElementById('nx-char-scope-bar')?.dataset.uxSelectedScope === 'global' ? '__global__' : actions.characterTarget().session_id;
}
