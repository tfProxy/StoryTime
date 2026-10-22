"use client";

import { useMemo, type ComponentProps } from "react";
import type { CodexPicture } from "@/lib/codexPictures";
import type { PictureJob } from "@/lib/pictureJobs";
import { codexTarget } from "@/lib/pictureTarget";
import CodexPictureCard from "./CodexPictureCard";
import CodexPromptPanel from "./CodexPromptPanel";
import PictureWorkspace from "./PictureWorkspace";

type Props = Omit<ComponentProps<typeof CodexPromptPanel>, "loaded" | "refRequest" | "pinned" | "start" | "onClearStart" | "startMode" | "onStartMode" | "paint" | "editModels" | "onPictures" | "onQueue" | "dock"> & {
  /** Every chapter's title in the story, by chapter id. */
  titles: Record<string, string>;
  /** The entry's picture as of the chapter the page was opened from (or from the start), or null. */
  current: CodexPicture | null;
  /** The chapter the page was opened from, which a picture can be saved from. */
  from: { id: string; title: string } | null;
  /** The entry's picture jobs as the page opened, newest first, with their marks. */
  jobs: PictureJob[];
};

/**
 * The codex entry's picture page: the prompt and Make pictures on one side; the entry's current picture and
 * the new pictures on the other (see `PictureWorkspace`).
 */
export default function CodexWorkspace({ titles, current, from, jobs, ...panel }: Props) {
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
      destination={(w) => <CodexPictureCard storyId={panel.story.id} entry={panel.entry} current={current} titles={titles} workspace={w} />}
      controls={(w) => (
        <CodexPromptPanel
          {...panel}
          loaded={w.loaded}
          refRequest={w.refRequest}
          pinned={w.pinned}
          start={w.start}
          startMode={w.startMode}
          onStartMode={w.setStartMode}
          paint={{ mask: w.mask, onMask: w.setMask, nonce: w.paintNonce }}
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
