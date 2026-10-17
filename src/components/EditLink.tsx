import Link from "next/link";

export default function EditLink({ chapterId }: { chapterId: string }) {
  return <Link href={`/c/${chapterId}/edit`}>Edit this chapter</Link>;
}
