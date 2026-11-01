"use client";

import { useMemo, useState, type ComponentProps } from "react";
import type { CodexPicture } from "@/lib/codexPictures";
import type { PictureJob } from "@/lib/pictureJobs";
import { codexTarget } from "@/lib/pictureTarget";
import CodexPictureCard from "./CodexPictureCard";
import CodexPromptPanel from "./CodexPromptPanel";
import PictureWorkspace from "./PictureWorkspace";

type Props = Omit<ComponentProps<typeof CodexPromptPanel>, "loaded" | "refRequest" | "pinned" | "start" | "onClearStart" |"editModels" | "onPictures" | "onQueue" | "dock"> & {
  /** Every chapter's title in the story, by chapter id. */
  titles: Record<string, string>;
  /** The entry's picture as of the chapter the page was opened from (or from the start), or null. */
  current: CodexPicture | null;
  /** The chapter the page was opened from, which a picture can be saved from. */
  from: { id: string; title: string } | null;
  /** The entry's picture jobs as the page opened, newest first, with their marks. */
  jobs: PictureJob[];
  /** True when the entry is linked to a shared entry, so a picture can be kept for every story that uses it. */
  linked: boolean;
};

/**
 * The codex entry's picture page: the prompt and Make pictures on one side; the entry's current picture and
 * the new pictures on the other (see `PictureWorkspace`).
 */
export default function CodexWorkspace({ titles, current, from, jobs, linked, ...panel }: Props) {
  const [everyStory, setEveryStory] = useState(false);
  const versions = useMemo(() => ({}), []);
  const madeBySlot = useMemo(() => ({ codex: current?.made ?? null }), [current]);

  return (
    <PictureWorkspace
      target={codexTarget(panel.story.id, panel.entry.id)}
      jobs={jobs}
      titles={titles}
      versions={versions}
      made={madeBySlot}
      codexFrom={from}
      codexShared={linked && everyStory}
      destination={(w) => (
        <CodexPictureCard
          storyId={panel.story.id}
          entry={panel.entry}
          current={current}
          titles={titles}
          workspace={w}
          scope={linked ? { everyStory, onChange: setEveryStory } : null}
        />
      )}
      controls={(w) => (
        <CodexPromptPanel
          {...panel}
          loaded={w.loaded}
          refRequest={w.refRequest}
          pinned={w.pinned}
          start={w.start}
          editModels={w.editModels}
          onClearStart={w.onClearStart}
          onPictures={w.addPictures}
          onQueue={w.setPending}
          dock={w.dock}
        />
      )}
    />
  );
}
