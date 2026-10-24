// Shared by the server (validation) and the browser (input maxLength).
export const LIMITS = {
  title: 200,
  premise: 5000,
  style: 3000,
  artStyle: 1000,
  picturePrompt: 20000,
  body: 50000,
  summary: 5000,
  label: 200,
  choices: 12,
  /** Most chapters one AI run may write, and most tasks (writing, planning, pictures) it may hold. */
  runChapters: 200,
  runTasks: 2000,
};
