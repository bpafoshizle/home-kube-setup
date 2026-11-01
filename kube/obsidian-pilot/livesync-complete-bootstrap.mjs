import { finalizeInitialState } from './livesync-bookkeeping.mjs';
// Prior sync/mirror exited successfully; this only verifies and checkpoints the
// explicit new empty bootstrap, preserving all existing application state.
finalizeInitialState().then(result => console.log(JSON.stringify(result))).catch(() => {
  console.error('PILOT_LIVESYNC_INITIAL_CHECKPOINT_REFUSED'); process.exit(1);
});
