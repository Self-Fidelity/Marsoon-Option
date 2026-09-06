import type { Metadata } from "next";

import { TeachingView } from "./TeachingView";

export const metadata: Metadata = { title: "教学看板" };

export default function TeachingPage() {
  return <TeachingView />;
}
