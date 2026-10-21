// Imported first by every test that runs git. Git runs `gc --auto` / `maintenance run --auto`
// detached after commit, and that background process can rewrite packs or still be writing
// into the repo while the next git command or the test's cleanup runs. Spawned git (the tests'
// and the CLI's) inherits process.env, so this turns auto maintenance off for all of them.
process.env.GIT_CONFIG_COUNT = '3';
process.env.GIT_CONFIG_KEY_0 = 'gc.auto';
process.env.GIT_CONFIG_VALUE_0 = '0';
process.env.GIT_CONFIG_KEY_1 = 'maintenance.auto';
process.env.GIT_CONFIG_VALUE_1 = 'false';
process.env.GIT_CONFIG_KEY_2 = 'gc.autoDetach';
process.env.GIT_CONFIG_VALUE_2 = 'false';
