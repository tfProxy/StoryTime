"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { prepareImage } from "@/lib/prepareImage";
import { asReference, DEFAULT_WEIGHTS, MAX_REFERENCES, REFERENCE_ROLES, type Reference, type ReferenceRole } from "@/lib/comfy/references";
import type { RefChoice } from "@/lib/comfy/referenceChoices";
import type { StartPicture } from "@/lib/comfy/startPicture";

const ROLE_NAMES: Record<ReferenceRole, string> = { character: "Character", item: "Item", place: "Place", style: "Style" };

/** The longest side an uploaded reference keeps; bigger pictures are scaled down in the browser first. */
const MAX_SIDE = 1024;

type Tab = "suggested" | "pictures" | "codex" | "upload";

type PickerProps = {
  suggested: RefChoice[];
  pictures: RefChoice[];
  /** The codex entries that have a picture as of this chapter. */
  codex: RefChoice[];
  /** The sources already chosen, which can't be chosen again. */
  chosen: string[];
  full: boolean;
  /** Leaves the Upload tab out (a picture that must be kept can't be an upload), and words the dialog for a style picture. */
  noUpload?: boolean;
  onPick: (picture: StartPicture, label: string, role?: ReferenceRole) => void;
  onClose: () => void;
};

/** The picker: a modal <dialog> with the pictures that suit this moment, the others on offer, the codex's, and an upload. */
export function ReferencePicker({ suggested, pictures, codex, chosen, full, noUpload = false, onPick, onClose }: PickerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<Tab>(suggested.length > 0 ? "suggested" : "pictures");
  const [error, setError] = useState<string | null>(null);

  // Closing it removes it rather than calling close(), so the focus is put back by hand.
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    return () => back?.focus({ preventScroll: true });
  }, []);

  async function upload(file: File) {
    setError(null);
    try {
      const blob = await prepareImage(file, MAX_SIDE).catch(() => file);
      const name = file.name.replace(/\.[^.]*$/, "") || "Upload";
      const picture: StartPicture = {
        key: `upload:${file.name}:${Date.now()}`,
        source: `upload:${file.name}`,
        thumb: URL.createObjectURL(blob),
        blob: async () => blob,
      };
      onPick(picture, name.length > 20 ? `${name.slice(0, 19).trimEnd()}…` : name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const list = (choices: RefChoice[], empty: string) => {
    if (choices.length === 0) return <p className="meta">{empty}</p>;
    const groups = [...new Set(choices.map((c) => c.group))];
    return groups.map((group) => (
      <div key={group} className="reference-group">
        {groups.length > 1 || group !== "Suggested" ? <h3>{group}</h3> : null}
        <ul className="reference-choices">
          {choices
            .filter((c) => c.group === group)
            .map((c) => {
              const already = chosen.includes(c.picture.source);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    className="secondary reference-choice"
                    disabled={already || full}
                    title={already ? "Already a reference" : full ? `A picture takes at most ${MAX_REFERENCES} references` : `Use ${c.label} as a reference`}
                    onClick={() => onPick(c.picture, c.label, c.role)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- a picture of unknown size */}
                    <img src={c.picture.thumb} alt="" />
                    <span className="reference-choice-label">{c.label}</span>
                    <span className="meta">{c.hint}</span>
                  </button>
                </li>
              );
            })}
        </ul>
      </div>
    ));
  };

  const tabs: { id: Tab; name: string }[] = [
    { id: "suggested", name: "Suggested" },
    { id: "pictures", name: "Pictures" },
    { id: "codex", name: "Codex" },
    ...(noUpload ? [] : [{ id: "upload" as Tab, name: "Upload" }]),
  ];
  return (
    <dialog
      ref={dialog}
      className="reference-picker"
      aria-labelledby="reference-picker-title"
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="picture-info-top">
        <h2 id="reference-picker-title">Add a reference</h2>
        <button type="button" className="secondary" onClick={onClose} aria-label="Close" title="Close (Esc)">
          ✕
        </button>
      </div>
      {full && <p className="meta">A picture takes at most {MAX_REFERENCES} references. Remove one to add another.</p>}
      <div className="row start-modes" role="tablist" aria-label="Where to choose from">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? undefined : "secondary"} onClick={() => setTab(t.id)}>
            {t.name}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="reference-panel">
        {tab === "suggested" && list(suggested, "Nothing is suggested yet: the pictures that fit this moment (a header for a footer, the previous chapter's footer…) haven't been saved.")}
        {tab === "pictures" && list(pictures, "No pictures to choose from yet. Pin a picture, or save a header, footer or cover.")}
        {tab === "codex" && list(codex, "No codex entry has a picture here yet. Make one from the Codex panel (Make a picture).")}
        {tab === "upload" && (
          <>
            <label>
              Choose a picture file
              <input
                type="file"
                accept="image/*"
                aria-label="Reference file"
                disabled={full}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void upload(file);
                }}
              />
            </label>
            <p className="meta">An uploaded picture is used for this visit only; it isn&apos;t kept when you leave the page.</p>
          </>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </dialog>
  );
}

type Props = {
  refs: Reference[];
  onChange: (refs: Reference[]) => void;
  suggested: RefChoice[];
  pictures: RefChoice[];
  codex: RefChoice[];
  /** Why references can't be used with the drawing preset now, or null when they can. Then the section is only its heading and this. */
  unavailable: string | null;
  /** On the Instruct tab: the edit model's name and how many references it uses; the rest are left out. */
  editLimit: { model: string; count: number } | null;
  /** The story's style picture, shown as a fixed first row with a switch; it counts toward the limit while it is on. */
  story?: { ref: Reference; on: boolean; onChange: (on: boolean) => void } | null;
};

/**
 * The reference pictures of the next picture: a thumbnail for each with a label, what it shows, how strongly
 * to follow it and a button to take it out, and an Add reference button that opens the picker.
 */
export default function References({ refs, onChange, suggested, pictures, codex, unavailable, editLimit, story = null }: Props) {
  const [picking, setPicking] = useState(false);
  const styleShown = story !== null && !editLimit;
  const full = refs.length + (styleShown && story.on ? 1 : 0) >= MAX_REFERENCES;
  const change = (key: string, patch: Partial<Reference>) => onChange(refs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  if (unavailable) {
    return (
      <section className="ai-panel references-panel references-collapsed" id="picture-references">
        <h2>References</h2>
        <p className="meta" style={{ margin: 0 }}>
          {unavailable} <Link href="/settings#comfyui">Open Settings</Link>
        </p>
      </section>
    );
  }
  return (
    <section className="ai-panel references-panel" id="picture-references">
      <h2>References</h2>
      {styleShown && (
        <div className="reference-item story-style" aria-label="Story style picture">
          {/* eslint-disable-next-line @next/next/no-img-element -- a picture of unknown size */}
          <img className="reference-thumb" src={story.ref.thumb} alt="Story style picture" style={story.on ? undefined : { opacity: 0.4 }} />
          <div className="reference-fields">
            <strong>Story style</strong>
            <span className="meta">Style, strength {story.ref.weight.toFixed(2)} (changed on the story&apos;s details page)</span>
            <label className="row" style={{ gap: "0.4rem" }}>
              <input type="checkbox" checked={story.on} onChange={(e) => story.onChange(e.target.checked)} style={{ width: "auto" }} />
              Use the story&apos;s style picture
            </label>
          </div>
        </div>
      )}
      {refs.length === 0 && !styleShown ? (
        <p className="meta" style={{ margin: 0 }}>
          Pictures to keep a character, item, place or style the same.
        </p>
      ) : refs.length > 0 ? (
        <ul className="reference-list" aria-label="Reference pictures">
          {refs.map((r, i) => (
            <li key={r.key} className="reference-item">
              {/* eslint-disable-next-line @next/next/no-img-element -- a picture of unknown size */}
              <img className="reference-thumb" src={r.thumb} alt={`Reference ${i + 1}: ${r.label}`} />
              <div className="reference-fields">
                <div className="reference-top">
                  <input
                    type="text"
                    aria-label={`Label of reference ${i + 1}`}
                    value={r.label}
                    maxLength={40}
                    title={r.source.startsWith("upload:") ? "An uploaded picture isn't kept when you leave the page" : undefined}
                    onChange={(e) => change(r.key, { label: e.target.value })}
                  />
                  <button type="button" className="secondary icon-button" aria-label={`Remove reference ${r.label}`} title="Remove this reference" onClick={() => onChange(refs.filter((x) => x.key !== r.key))}>
                    ✕
                  </button>
                </div>
                <select
                  aria-label={`Role of reference ${i + 1}`}
                  value={r.role}
                  // A new role also brings its usual strength, unless the author already moved it.
                  onChange={(e) => {
                    const role = e.target.value as ReferenceRole;
                    change(r.key, { role, weight: r.weight === DEFAULT_WEIGHTS[r.role] ? DEFAULT_WEIGHTS[role] : r.weight });
                  }}
                >
                  {REFERENCE_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_NAMES[role]}
                    </option>
                  ))}
                </select>
                <label className="strength">
                  Strength {r.weight.toFixed(2)}
                  <input type="range" aria-label={`Strength of reference ${i + 1}`} min={0} max={1} step={0.05} value={Math.min(r.weight, 1)} onChange={(e) => change(r.key, { weight: Number(e.target.value) })} />
                  <span className="strength-ends" aria-hidden="true">
                    <span>Low</span>
                    <span>High</span>
                  </span>
                </label>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {editLimit && refs.length > editLimit.count && (
        <p className="meta" style={{ margin: 0 }}>
          {editLimit.model} uses the first {editLimit.count} reference{editLimit.count === 1 ? "" : "s"} of an instruction; the others are left out.
        </p>
      )}
      <button type="button" className="secondary" onClick={() => setPicking(true)} disabled={full} title={full ? `A picture takes at most ${MAX_REFERENCES} references` : "Choose a picture to keep something the same"} style={{ justifySelf: "start" }}>
        Add reference
      </button>
      {full && (
        <p className="meta" style={{ margin: 0 }}>
          That is the most a picture takes ({MAX_REFERENCES}). Remove one to add another.
        </p>
      )}
      {picking && (
        <ReferencePicker
          suggested={suggested}
          pictures={pictures}
          codex={codex}
          chosen={refs.map((r) => r.source)}
          full={full}
          onPick={(picture, label, role = "character") => {
            if (!refs.some((r) => r.source === picture.source) && !full) onChange([...refs, asReference(picture, label, role)]);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </section>
  );
}
